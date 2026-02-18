// ABOUTME: Core workflow interpreter that drives generator-based workflows.
// ABOUTME: Executes commands, records events, and supports replay from event log.

import { EventLog } from "./event-log";
import {
	CancelledError,
	type ActivityScheduledEvent,
	type AnyWorkflowFunction,
	type Command,
	type InternalWorkflowContext,
	type SignalReceivedEvent,
	type WaitAllCompletedEvent,
	type WaitAllItem,
	type WorkflowCancelledEvent,
	type WorkflowCompletedEvent,
	type WorkflowContext,
	type WorkflowEvent,
	type WorkflowFailedEvent,
	type WorkflowFunction,
	type WorkflowRef,
	type WorkflowRegistryInterface,
	type WorkflowState,
} from "./types";

export class Interpreter {
	readonly context: InternalWorkflowContext;

	private workflowFn: AnyWorkflowFunction;
	private log: EventLog;
	private seq = 0;
	private _state: WorkflowState = "running";
	private _result: unknown;
	private _error: string | undefined;
	private _waitingFor: string | undefined;
	private pendingSignal:
		| {
				resolve: (payload: unknown) => void;
		  }
		| undefined;
	private _waitingForAll: string[] | undefined;
	private pendingWaitAll:
		| {
				needed: Set<string>;
				seq: number;
				onSignal: (name: string, payload: unknown) => void;
				onComplete: () => void;
		  }
		| undefined;
	private _queries = new Map<string, () => unknown>();
	private changeListeners: Array<() => void> = [];
	private registry?: WorkflowRegistryInterface;
	private _abortController: AbortController | null = null;
	private _pendingReject: ((err: CancelledError) => void) | null = null;
	private _sleepTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		workflowFn: AnyWorkflowFunction,
		log: EventLog,
		registry?: WorkflowRegistryInterface,
	) {
		this.workflowFn = workflowFn;
		this.log = log;
		this.registry = registry;
		this.seq = 0;

		// The context methods work with `unknown` internally; generic narrowing
		// happens at the WorkflowFunction<T, SignalMap, WorkflowMap> level for end users.
		this.context = {
			query: (name: string, handler: () => unknown) => {
				this._queries.set(name, handler);
			},
			activity: <T>(name: string, fn: (signal: AbortSignal) => Promise<T>) => {
				const seq = ++this.seq;
				return (function* (): Generator<Command, T, unknown> {
					const result = yield { type: "activity" as const, name, fn, seq };
					return result as T;
				})();
			},
			waitFor: (signalName: string) => {
				const seq = ++this.seq;
				return (function* (): Generator<Command, unknown, unknown> {
					const result = yield {
						type: "waitFor" as const,
						signal: signalName,
						seq,
					};
					return result;
				})();
			},
			sleep: (durationMs: number) => {
				const seq = ++this.seq;
				return (function* (): Generator<Command, void, unknown> {
					yield { type: "sleep" as const, durationMs, seq };
				})();
			},
			parallel: <T>(
				activities: Array<{
					name: string;
					fn: (signal: AbortSignal) => Promise<T>;
				}>,
			) => {
				const seq = ++this.seq;
				// Pre-allocate seq numbers for each activity within the parallel block
				const seqActivities = activities.map((a) => ({
					...a,
					seq: ++this.seq,
				}));
				return (function* (): Generator<Command, T[], unknown> {
					const result = yield {
						type: "parallel" as const,
						activities: seqActivities,
						seq,
					};
					return result as T[];
				})();
			},
			child: <T, CS extends Record<string, unknown>>(
				name: string,
				workflow: WorkflowFunction<T, CS>,
			) => {
				const seq = ++this.seq;
				return (function* (): Generator<Command, T, unknown> {
					const result = yield {
						type: "child" as const,
						name,
						workflow: workflow as AnyWorkflowFunction,
						seq,
					};
					return result as T;
				})();
			},
			waitAll: (...args: (string | WorkflowRef)[]) => {
				const seq = ++this.seq;
				const items: WaitAllItem[] = args.map((arg) =>
					typeof arg === "string"
						? { kind: "signal" as const, name: arg }
						: { kind: "workflow" as const, workflowId: arg.workflow },
				);
				return (function* (): Generator<Command, unknown, unknown> {
					const result = yield {
						type: "waitAll" as const,
						items,
						seq,
					};
					return result;
				})();
			},
			waitForWorkflow: (workflowId: string, options?: { start?: boolean }) => {
				const seq = ++this.seq;
				const start = options?.start ?? true;
				return (function* (): Generator<Command, unknown, unknown> {
					const result = yield {
						type: "waitForWorkflow" as const,
						workflowId,
						start,
						seq,
					};
					return result;
				})();
			},
			workflow: (id: string): WorkflowRef => {
				return { __brand: "WorkflowRef", workflow: id } as WorkflowRef;
			},
		};
	}

	onStateChange(callback: () => void): () => void {
		this.changeListeners.push(callback);
		return () => {
			const idx = this.changeListeners.indexOf(callback);
			if (idx !== -1) this.changeListeners.splice(idx, 1);
		};
	}

	private notifyChange(): void {
		for (const listener of this.changeListeners) {
			listener();
		}
	}

	get events(): WorkflowEvent[] {
		return this.log.events();
	}

	get state(): WorkflowState {
		return this._state;
	}

	get result(): unknown {
		return this._result;
	}

	get error(): string | undefined {
		return this._error;
	}

	get waitingFor(): string | undefined {
		return this._waitingFor;
	}

	get waitingForAll(): string[] | undefined {
		return this._waitingForAll;
	}

	query(name: string): unknown {
		return this._queries.get(name)?.();
	}

	signal(name: string, payload?: unknown): void {
		if (this._state !== "waiting") return;

		// Single waitFor path
		if (this._waitingFor === name) {
			this.log.append({
				type: "signal_received",
				signal: name,
				payload,
				seq: this.findWaitingSeq(),
				timestamp: Date.now(),
			});
			this._state = "running";
			this._waitingFor = undefined;
			this.notifyChange();
			this.pendingSignal?.resolve(payload);
			this.pendingSignal = undefined;
			return;
		}

		// waitAll path
		if (this.pendingWaitAll?.needed.has(name)) {
			const pending = this.pendingWaitAll;
			pending.needed.delete(name);

			this.log.append({
				type: "signal_received",
				signal: name,
				payload,
				seq: pending.seq,
				timestamp: Date.now(),
			});

			pending.onSignal(name, payload);
			this._waitingForAll = [...pending.needed];

			if (pending.needed.size === 0) {
				pending.onComplete();
			} else {
				this.notifyChange();
			}
		}
	}

	cancel(): void {
		if (
			this._state === "completed" ||
			this._state === "failed" ||
			this._state === "cancelled"
		) {
			return;
		}

		this._state = "cancelled";
		this.log.append({ type: "workflow_cancelled", timestamp: Date.now() });

		// Abort in-flight activity
		this._abortController?.abort();
		this._abortController = null;

		// Reject pending waitFor/sleep
		this._pendingReject?.(new CancelledError());
		this._pendingReject = null;

		// Clear sleep timer
		if (this._sleepTimer !== null) {
			clearTimeout(this._sleepTimer);
			this._sleepTimer = null;
		}

		this._waitingFor = undefined;
		this._waitingForAll = undefined;
		this.pendingSignal = undefined;
		this.pendingWaitAll = undefined;
		this.notifyChange();
	}

	private findWaitingSeq(): number {
		// The seq of the current waitFor command is the current seq counter
		return this.seq;
	}

	private isReplayingEvent(type: string): boolean {
		return this.log.events().some((e) => e.type === type);
	}

	async run(): Promise<unknown> {
		if (!this.isReplayingEvent("workflow_started")) {
			// No workflow_started in the log — either a fresh run or compacted storage.
			// Check for compacted terminal events before starting the generator.
			const events = this.log.events();
			const completed = events.find(
				(e): e is WorkflowCompletedEvent => e.type === "workflow_completed",
			);
			if (completed) {
				this._state = "completed";
				this._result = completed.result;
				this.notifyChange();
				return this._result;
			}
			const failed = events.find(
				(e): e is WorkflowFailedEvent => e.type === "workflow_failed",
			);
			if (failed) {
				this._state = "failed";
				this._error = failed.error;
				this.notifyChange();
				return undefined;
			}
			const cancelled = events.find(
				(e): e is WorkflowCancelledEvent => e.type === "workflow_cancelled",
			);
			if (cancelled) {
				this._state = "cancelled";
				this.notifyChange();
				return undefined;
			}

			this.log.append({ type: "workflow_started", timestamp: Date.now() });
		}

		// InternalWorkflowContext is structurally identical to WorkflowContext at
		// runtime. The only gap is waitAll's mapped-tuple return type which TS
		// can't unify with `unknown` for a generic K — a known TS limitation.
		const gen = this.workflowFn(this.context as unknown as WorkflowContext);

		try {
			let next = gen.next();

			while (!next.done) {
				const command = next.value as Command;
				try {
					const result = await this.executeCommand(command);
					next = gen.next(result);
				} catch (err) {
					next = gen.throw(err);
				}
			}

			this._result = next.value;
			this._state = "completed";
			if (!this.isReplayingEvent("workflow_completed")) {
				this.log.append({
					type: "workflow_completed",
					result: next.value,
					timestamp: Date.now(),
				});
			}
			this.notifyChange();

			return next.value;
		} catch (err) {
			if (err instanceof CancelledError) {
				// cancel() already set state and logged the event
				return undefined;
			}
			const message = err instanceof Error ? err.message : String(err);
			const stack = err instanceof Error ? err.stack : undefined;
			this._state = "failed";
			this._error = message;
			if (!this.isReplayingEvent("workflow_failed")) {
				this.log.append({
					type: "workflow_failed",
					error: message,
					stack,
					timestamp: Date.now(),
				});
			}
			this.notifyChange();
			return undefined;
		}
	}

	private async executeCommand(command: Command): Promise<unknown> {
		switch (command.type) {
			case "activity":
				return this.executeActivity(command);
			case "waitFor":
				return this.executeWaitFor(command);
			case "waitAll":
				return this.executeWaitAll(command);
			case "sleep":
				return this.executeSleep(command);
			case "parallel":
				return this.executeParallel(command);
			case "child":
				return this.executeChild(command);
			case "waitForWorkflow":
				return this.executeWaitForWorkflow(command);
			default: {
				const _exhaustive: never = command;
				throw new Error(`Unknown command type: ${_exhaustive}`);
			}
		}
	}

	private async executeActivity(
		command: Extract<Command, { type: "activity" }>,
	): Promise<unknown> {
		const completed = this.log.findCompleted(command.seq, "activity_completed");
		if (completed) {
			this.verifyActivityReplay(command);
			return (completed as { result: unknown }).result;
		}

		const failed = this.log.findCompleted(command.seq, "activity_failed");
		if (failed) {
			this.verifyActivityReplay(command);
			throw new Error((failed as { error: string }).error);
		}

		this.log.append({
			type: "activity_scheduled",
			name: command.name,
			seq: command.seq,
			timestamp: Date.now(),
		});

		const controller = new AbortController();
		this._abortController = controller;

		try {
			// Race the activity against a cancellation rejection
			const result = await new Promise<unknown>((resolve, reject) => {
				this._pendingReject = reject;
				command.fn(controller.signal).then(resolve, reject);
			});
			this._abortController = null;
			this._pendingReject = null;
			this.log.append({
				type: "activity_completed",
				seq: command.seq,
				result,
				timestamp: Date.now(),
			});
			return result;
		} catch (err) {
			this._abortController = null;
			this._pendingReject = null;
			if (err instanceof CancelledError) {
				throw err;
			}
			const message = err instanceof Error ? err.message : String(err);
			const stack = err instanceof Error ? err.stack : undefined;
			this.log.append({
				type: "activity_failed",
				seq: command.seq,
				error: message,
				stack,
				timestamp: Date.now(),
			});
			throw err;
		}
	}

	private async executeWaitFor(
		command: Extract<Command, { type: "waitFor" }>,
	): Promise<unknown> {
		// Check for replay
		const received = this.log.findCompleted(command.seq, "signal_received");
		if (received) {
			return (received as SignalReceivedEvent).payload;
		}

		// Live: pause until signal() is called
		this._state = "waiting";
		this._waitingFor = command.signal;

		return new Promise((resolve, reject) => {
			this.pendingSignal = { resolve };
			this._pendingReject = reject;
			// Notify after pendingSignal is set so signal() can resolve the promise
			this.notifyChange();
		});
	}

	private async executeWaitAll(
		command: Extract<Command, { type: "waitAll" }>,
	): Promise<unknown> {
		const itemKeys = command.items.map(waitAllItemKey);

		// Check for replay
		const completed = this.log.findCompleted(command.seq, "wait_all_completed");
		if (completed) {
			const results = (completed as WaitAllCompletedEvent).results;
			return itemKeys.map((k) => results[k]);
		}

		// Live: record start event
		this.log.append({
			type: "wait_all_started",
			items: command.items,
			seq: command.seq,
			timestamp: Date.now(),
		});

		const signalItems = command.items.filter(
			(i): i is Extract<WaitAllItem, { kind: "signal" }> => i.kind === "signal",
		);
		const workflowItems = command.items.filter(
			(i): i is Extract<WaitAllItem, { kind: "workflow" }> =>
				i.kind === "workflow",
		);

		// Require registry when workflow items are present
		const registry = this.registry;
		if (workflowItems.length > 0 && !registry) {
			throw new Error(
				"waitAll with workflow items requires a WorkflowRegistry. Wrap your app in a WorkflowLayerProvider.",
			);
		}

		const collected = new Map<string, unknown>();
		let remaining = command.items.length;

		this._state = "waiting";
		this._waitingForAll = signalItems.map((i) => i.name);

		return new Promise((resolve, reject) => {
			const tryComplete = () => {
				if (remaining > 0) return;

				const results: Record<string, unknown> = {};
				for (const [k, v] of collected) {
					results[k] = v;
				}
				this.log.append({
					type: "wait_all_completed",
					seq: command.seq,
					results,
					timestamp: Date.now(),
				});
				this._state = "running";
				this._waitingForAll = undefined;
				this.pendingWaitAll = undefined;
				this.notifyChange();
				resolve(itemKeys.map((k) => results[k]));
			};

			// Set up signal collection
			this.pendingWaitAll = {
				needed: new Set(signalItems.map((i) => i.name)),
				seq: command.seq,
				onSignal: (name, payload) => {
					collected.set(name, payload);
					remaining--;
				},
				onComplete: tryComplete,
			};

			// Fire workflow waits concurrently
			for (const item of workflowItems) {
				const key = waitAllItemKey(item);

				this.log.append({
					type: "workflow_dependency_started",
					workflowId: item.workflowId,
					seq: command.seq,
					timestamp: Date.now(),
				});

				registry
					?.waitFor(item.workflowId, { start: true })
					.then((result) => {
						collected.set(key, result);
						remaining--;

						this.log.append({
							type: "workflow_dependency_completed",
							workflowId: item.workflowId,
							seq: command.seq,
							result,
							timestamp: Date.now(),
						});

						tryComplete();
					})
					.catch(reject);
			}

			this.notifyChange();
		});
	}

	private async executeSleep(
		command: Extract<Command, { type: "sleep" }>,
	): Promise<void> {
		// Check for replay
		const fired = this.log.findCompleted(command.seq, "timer_fired");
		if (fired) {
			return;
		}

		// Live: set up timer
		this.log.append({
			type: "timer_started",
			seq: command.seq,
			durationMs: command.durationMs,
			timestamp: Date.now(),
		});

		await new Promise<void>((resolve, reject) => {
			this._pendingReject = reject;
			this._sleepTimer = setTimeout(() => {
				this._sleepTimer = null;
				this._pendingReject = null;
				this.log.append({
					type: "timer_fired",
					seq: command.seq,
					timestamp: Date.now(),
				});
				resolve();
			}, command.durationMs);
		});
	}

	private async executeChild(
		command: Extract<Command, { type: "child" }>,
	): Promise<unknown> {
		// Check for replay
		const completed = this.log.findCompleted(command.seq, "child_completed");
		if (completed) {
			return (completed as { result: unknown }).result;
		}

		// Live: create a sub-interpreter with its own event log
		this.log.append({
			type: "child_started",
			name: command.name,
			workflowId: command.name,
			seq: command.seq,
			timestamp: Date.now(),
		});

		const childLog = new EventLog();
		const childInterpreter = new Interpreter(command.workflow, childLog);
		const result = await childInterpreter.run();

		if (childInterpreter.state === "failed") {
			const childFailedEvent = childLog
				.events()
				.find((e) => e.type === "workflow_failed");
			const stack =
				childFailedEvent?.type === "workflow_failed"
					? childFailedEvent.stack
					: undefined;
			this.log.append({
				type: "child_failed",
				workflowId: command.name,
				seq: command.seq,
				error: childInterpreter.error ?? "Unknown error",
				stack,
				timestamp: Date.now(),
			});
			throw new Error(childInterpreter.error ?? "Child workflow failed");
		}

		this.log.append({
			type: "child_completed",
			workflowId: command.name,
			seq: command.seq,
			result,
			timestamp: Date.now(),
		});

		return result;
	}

	private async executeWaitForWorkflow(
		command: Extract<Command, { type: "waitForWorkflow" }>,
	): Promise<unknown> {
		// Check for replay
		const completed = this.log.findCompleted(
			command.seq,
			"workflow_dependency_completed",
		);
		if (completed) {
			return (completed as { result: unknown }).result;
		}

		// Live: require registry
		if (!this.registry) {
			throw new Error(
				"waitForWorkflow requires a WorkflowRegistry. Wrap your app in a WorkflowLayerProvider.",
			);
		}

		this.log.append({
			type: "workflow_dependency_started",
			workflowId: command.workflowId,
			seq: command.seq,
			timestamp: Date.now(),
		});

		const result = await this.registry.waitFor(command.workflowId, {
			start: command.start,
		});

		this.log.append({
			type: "workflow_dependency_completed",
			workflowId: command.workflowId,
			seq: command.seq,
			result,
			timestamp: Date.now(),
		});

		return result;
	}

	private async executeParallel(
		command: Extract<Command, { type: "parallel" }>,
	): Promise<unknown[]> {
		const promises = command.activities.map((activity) =>
			this.executeActivity({
				type: "activity",
				name: activity.name,
				fn: activity.fn,
				seq: activity.seq,
			}),
		);
		return Promise.all(promises);
	}

	private verifyActivityReplay(
		command: Extract<Command, { type: "activity" }>,
	): void {
		const scheduled = this.log
			.events()
			.find(
				(e): e is ActivityScheduledEvent =>
					e.type === "activity_scheduled" && e.seq === command.seq,
			);
		if (scheduled && scheduled.name !== command.name) {
			throw new Error(
				`Non-determinism detected: activity at seq ${command.seq} was "${scheduled.name}" but is now "${command.name}"`,
			);
		}
	}
}

function waitAllItemKey(item: WaitAllItem): string {
	return item.kind === "signal" ? item.name : `workflow:${item.workflowId}`;
}

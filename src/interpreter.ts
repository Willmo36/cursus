// ABOUTME: Core workflow interpreter that drives generator-based workflows.
// ABOUTME: Executes commands, records events, and supports replay from event log.

import { EventLog } from "./event-log";
import type {
	ActivityScheduledEvent,
	Command,
	InternalWorkflowContext,
	SignalReceivedEvent,
	WaitAllCompletedEvent,
	WorkflowContext,
	WorkflowEvent,
	WorkflowFunction,
	WorkflowRegistryInterface,
	WorkflowState,
} from "./types";

export class Interpreter {
	readonly context: InternalWorkflowContext;

	private workflowFn: WorkflowFunction<unknown>;
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
				collected: Map<string, unknown>;
				needed: Set<string>;
				signals: string[];
				resolve: (results: Record<string, unknown>) => void;
				seq: number;
		  }
		| undefined;
	private onChange?: () => void;
	private registry?: WorkflowRegistryInterface;

	constructor(
		workflowFn: WorkflowFunction<unknown>,
		log: EventLog,
		registry?: WorkflowRegistryInterface,
	) {
		this.workflowFn = workflowFn;
		this.log = log;
		this.registry = registry;
		this.seq = 0;

		// The context methods work with `unknown` internally; generic narrowing
		// happens at the WorkflowFunction<T, SignalMap> level for end users.
		this.context = {
			activity: <T>(name: string, fn: () => Promise<T>) => {
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
				activities: Array<{ name: string; fn: () => Promise<T> }>,
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
						workflow: workflow as WorkflowFunction<unknown>,
						seq,
					};
					return result as T;
				})();
			},
			waitAll: (...signals: string[]) => {
				const seq = ++this.seq;
				return (function* (): Generator<Command, unknown, unknown> {
					const result = yield {
						type: "waitAll" as const,
						signals,
						seq,
					};
					return result;
				})();
			},
			waitForWorkflow: <T>(
				workflowId: string,
				options?: { start?: boolean },
			) => {
				const seq = ++this.seq;
				const start = options?.start ?? true;
				return (function* (): Generator<Command, T, unknown> {
					const result = yield {
						type: "waitForWorkflow" as const,
						workflowId,
						start,
						seq,
					};
					return result as T;
				})();
			},
		};
	}

	onStateChange(callback: () => void): void {
		this.onChange = callback;
	}

	private notifyChange(): void {
		this.onChange?.();
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
			pending.collected.set(name, payload);
			pending.needed.delete(name);

			this.log.append({
				type: "signal_received",
				signal: name,
				payload,
				seq: pending.seq,
				timestamp: Date.now(),
			});

			this._waitingForAll = [...pending.needed];

			if (pending.needed.size === 0) {
				const results: Record<string, unknown> = {};
				for (const [k, v] of pending.collected) {
					results[k] = v;
				}
				this.log.append({
					type: "wait_all_completed",
					seq: pending.seq,
					results,
					timestamp: Date.now(),
				});
				this._state = "running";
				this._waitingForAll = undefined;
				this.pendingWaitAll = undefined;
				this.notifyChange();
				pending.resolve(results);
			} else {
				this.notifyChange();
			}
		}
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
			const message = err instanceof Error ? err.message : String(err);
			this._state = "failed";
			this._error = message;
			if (!this.isReplayingEvent("workflow_failed")) {
				this.log.append({
					type: "workflow_failed",
					error: message,
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

		try {
			const result = await command.fn();
			this.log.append({
				type: "activity_completed",
				seq: command.seq,
				result,
				timestamp: Date.now(),
			});
			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.log.append({
				type: "activity_failed",
				seq: command.seq,
				error: message,
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

		return new Promise((resolve) => {
			this.pendingSignal = { resolve };
			// Notify after pendingSignal is set so signal() can resolve the promise
			this.notifyChange();
		});
	}

	private async executeWaitAll(
		command: Extract<Command, { type: "waitAll" }>,
	): Promise<unknown> {
		// Check for replay
		const completed = this.log.findCompleted(command.seq, "wait_all_completed");
		if (completed) {
			const results = (completed as WaitAllCompletedEvent).results;
			return command.signals.map((s) => results[s]);
		}

		// Live: record start event, set up multi-signal collection
		this.log.append({
			type: "wait_all_started",
			signals: command.signals,
			seq: command.seq,
			timestamp: Date.now(),
		});

		this._state = "waiting";
		this._waitingForAll = [...command.signals];

		return new Promise((resolve) => {
			this.pendingWaitAll = {
				collected: new Map(),
				needed: new Set(command.signals),
				signals: command.signals,
				resolve: (results) => {
					// Map back to declaration-order tuple
					resolve(command.signals.map((s) => results[s]));
				},
				seq: command.seq,
			};
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

		await new Promise<void>((resolve) => {
			setTimeout(() => {
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
			this.log.append({
				type: "child_failed",
				workflowId: command.name,
				seq: command.seq,
				error: childInterpreter.error ?? "Unknown error",
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
				"waitForWorkflow requires a WorkflowRegistry. Wrap your app in a WorkflowRegistryProvider.",
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

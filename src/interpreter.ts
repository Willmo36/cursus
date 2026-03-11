// ABOUTME: Core workflow interpreter that drives generator-based workflows.
// ABOUTME: Executes commands, records events, and supports replay from event log.

import { EventLog } from "./event-log";
import {
	type ActivityScheduledEvent,
	type AllCompletedEvent,
	type AnyWorkflowFunction,
	CancelledError,
	type Command,
	type Descriptor,
	type InternalWorkflowContext,
	type RaceCompletedEvent,
	type SignalReceivedEvent,
	type WorkflowCancelledEvent,
	type WorkflowCompletedEvent,
	type WorkflowEvent,
	type WorkflowEventObserver,
	type WorkflowFailedEvent,
	type WorkflowRegistryInterface,
	type WorkflowState,
} from "./types";

class DoneSignal {
	constructor(public readonly value: unknown) {}
}

export class Interpreter {
	readonly context: InternalWorkflowContext;

	private workflowFn: AnyWorkflowFunction;
	private log: EventLog;
	private seq = 0;
	private _state: WorkflowState = "running";
	private _result: unknown;
	private _error: string | undefined;
	private _receiving: string | undefined;
	private pendingReceive:
		| {
				resolve: (payload: unknown) => void;
		  }
		| undefined;
	private _receivingAll: string[] | undefined;
	private _receivingAny: string[] | undefined;
	private _publishedValue: unknown;
	private changeListeners: Array<() => void> = [];
	private registry?: WorkflowRegistryInterface;
	private _abortController: AbortController | null = null;
	private _pendingReject: ((err: CancelledError) => void) | null = null;
	private _sleepTimer: ReturnType<typeof setTimeout> | null = null;
	private _raceCleanup: (() => void) | null = null;
	private _raceWaiters: Array<{
		signal: string;
		resolve: (payload: unknown) => void;
	}> | null = null;
	private _allWaiters: Array<{
		signal: string;
		resolve: (payload: unknown) => void;
	}> | null = null;
	private _workflowId?: string;
	private _activeChild: Interpreter | null = null;
	private observers: WorkflowEventObserver[];

	constructor(
		workflowFn: AnyWorkflowFunction,
		log: EventLog,
		registry?: WorkflowRegistryInterface,
		workflowId?: string,
		observers?: WorkflowEventObserver[],
	) {
		this.workflowFn = workflowFn;
		this.log = log;
		this.registry = registry;
		this._workflowId = workflowId;
		this.observers = observers ?? [];
		this.seq = 0;

		// The context methods work with `unknown` internally; generic narrowing
		// happens at the WorkflowContext<SignalMap, WorkflowMap> level for end users.
		this.context = {
			activity: <T>(name: string, fn: (signal: AbortSignal) => Promise<T>) => {
				return (function* (): Generator<Descriptor, T, unknown> {
					const result = yield { type: "activity" as const, name, fn };
					return result as T;
				})();
			},
			receive: (signalName: string) => {
				return (function* (): Generator<Descriptor, unknown, unknown> {
					const result = yield {
						type: "receive" as const,
						signal: signalName,
					};
					return result;
				})();
			},
			handle: <T>(
				handlers: Record<
					string,
					(
						ctx: InternalWorkflowContext,
						payload: unknown,
						done: (value: unknown) => Generator<Descriptor, never, unknown>,
					) => Generator<Descriptor, void, unknown>
				>,
			): Generator<Descriptor, T, unknown> => {
				const ctx = this.context;
				const handlerNames = Object.keys(handlers);
				const doneFn = (value: unknown): Generator<Descriptor, never, unknown> => {
					return (function* (): Generator<Descriptor, never, unknown> {
						throw new DoneSignal(value);
					})();
				};
				return (function* (): Generator<Descriptor, T, unknown> {
					for (;;) {
						const result = yield* ctx.race(
							...handlerNames.map((n) => ctx.receive(n)),
						);
						const signal = handlerNames[result.winner];
						const handler = handlers[signal];
						if (!handler) continue;
						try {
							yield* handler(ctx, result.value, doneFn);
						} catch (err) {
							if (err instanceof DoneSignal) {
								return err.value as T;
							}
							throw err;
						}
					}
				})();
			},
			sleep: (durationMs: number) => {
				return (function* (): Generator<Descriptor, void, unknown> {
					yield { type: "sleep" as const, durationMs };
				})();
			},
			child: <T>(
				name: string,
				workflow: AnyWorkflowFunction,
			) => {
				return (function* (): Generator<Descriptor, T, unknown> {
					const result = yield {
						type: "child" as const,
						name,
						workflow: workflow as AnyWorkflowFunction,
					};
					return result as T;
				})();
			},
			all: (...branches: Generator<Descriptor, unknown, unknown>[]) => {
				const items: Descriptor[] = branches.map((gen) => {
					const result = gen.next();
					if (result.done) throw new Error("All branch yielded no command");
					return result.value as Descriptor;
				});
				return (function* (): Generator<Descriptor, unknown[], unknown> {
					const result = yield {
						type: "all" as const,
						items,
					};
					return result as unknown[];
				})();
			},
			race: (...branches: Generator<Descriptor, unknown, unknown>[]) => {
				const items: Descriptor[] = branches.map((gen) => {
					const result = gen.next();
					if (result.done) throw new Error("Race branch yielded no command");
					return result.value as Descriptor;
				});
				return (function* (): Generator<
					Descriptor,
					{ winner: number; value: unknown },
					unknown
				> {
					const result = yield {
						type: "race" as const,
						items,
					};
					return result as { winner: number; value: unknown };
				})();
			},
			published: (workflowId: string, options?: { start?: boolean; where?: (value: unknown) => boolean; afterSeq?: number }) => {
				const start = options?.start ?? true;
				const where = options?.where;
				const afterSeq = options?.afterSeq;
				return (function* (): Generator<Descriptor, unknown, unknown> {
					const result = yield {
						type: "published" as const,
						workflowId,
						start,
						where,
						afterSeq,
					};
					return result;
				})();
			},
			join: (workflowId: string, options?: { start?: boolean }) => {
				const start = options?.start ?? true;
				return (function* (): Generator<Descriptor, unknown, unknown> {
					const result = yield {
						type: "join" as const,
						workflowId,
						start,
					};
					return result;
				})();
			},
			workflow: (id: string) => {
				return this.context.join(id);
			},
			publish: (value: unknown) => {
				return (function* (): Generator<Descriptor, void, unknown> {
					yield { type: "publish" as const, value };
				})();
			},
			subscribe: <T>(
				workflowId: string,
				options: { start?: boolean; where?: (value: unknown) => boolean },
				body: (
					ctx: InternalWorkflowContext,
					value: unknown,
					done: (value: unknown) => Generator<Descriptor, never, unknown>,
				) => Generator<Descriptor, void, unknown>,
			): Generator<Descriptor, T, unknown> => {
				const ctx = this.context;
				const start = options?.start;
				const where = options?.where;
				const getPublishSeq = () =>
					this.registry?.getPublishSeq(workflowId) ?? 0;
				const doneFn = (value: unknown): Generator<Descriptor, never, unknown> => {
					return (function* (): Generator<Descriptor, never, unknown> {
						throw new DoneSignal(value);
					})();
				};
				return (function* (): Generator<Descriptor, T, unknown> {
					// First iteration: get current or first matching value
					let value = yield* ctx.published(workflowId, { start, where });
					for (;;) {
						try {
							yield* body(ctx, value, doneFn);
						} catch (err) {
							if (err instanceof DoneSignal) {
								return err.value as T;
							}
							throw err;
						}
						// Body completed — wait for next publish
						value = yield* ctx.published(workflowId, {
							start,
							where,
							afterSeq: getPublishSeq(),
						});
					}
				})();
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

	get receiving(): string | undefined {
		return this._receiving;
	}

	get receivingAll(): string[] | undefined {
		return this._receivingAll;
	}

	get receivingAny(): string[] | undefined {
		return this._receivingAny;
	}

	get published(): unknown {
		return this._publishedValue;
	}

	signal(name: string, payload?: unknown): void {
		// Race signal branches take priority — a race may have both a bare
		// receive branch and a child branch, and the bare receive needs
		// to be reachable without being swallowed by _activeChild.
		if (this._raceWaiters) {
			const waiter = this._raceWaiters.find((w) => w.signal === name);
			if (waiter) {
				waiter.resolve(payload);
				return;
			}
		}

		// All signal branches — resolve one matching waiter (doesn't complete the whole block)
		if (this._allWaiters) {
			const idx = this._allWaiters.findIndex((w) => w.signal === name);
			if (idx !== -1) {
				const waiter = this._allWaiters[idx];
				this._allWaiters.splice(idx, 1);
				this._receivingAll = this._allWaiters.map((w) => w.signal);
				waiter.resolve(payload);
				return;
			}
		}

		if (this._activeChild) {
			this._activeChild.signal(name, payload);
			return;
		}

		if (this._state !== "waiting") return;

		// Single receive path
		if (this._receiving === name) {
			this.log.append({
				type: "signal_received",
				signal: name,
				payload,
				seq: this.findWaitingSeq(),
				timestamp: Date.now(),
			});
			this._state = "running";
			this._receiving = undefined;
			this.notifyChange();
			this.pendingReceive?.resolve(payload);
			this.pendingReceive = undefined;
			return;
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

		// Cancel active child
		this._activeChild?.cancel();
		this._activeChild = null;

		// Abort in-flight activity
		this._abortController?.abort();
		this._abortController = null;

		// Reject pending receive/sleep
		this._pendingReject?.(new CancelledError());
		this._pendingReject = null;

		// Clear sleep timer
		if (this._sleepTimer !== null) {
			clearTimeout(this._sleepTimer);
			this._sleepTimer = null;
		}

		// Clean up race branches
		this._raceCleanup?.();
		this._raceCleanup = null;
		this._raceWaiters = null;

		// Clean up all branches
		this._allWaiters = null;

		this._receiving = undefined;
		this._receivingAll = undefined;
		this._receivingAny = undefined;
		this.pendingReceive = undefined;
		this.notifyChange();
	}

	private syncChildState(): void {
		const child = this._activeChild;
		if (!child) return;

		if (child.state === "waiting") {
			this._state = "waiting";
			this._receiving = child.receiving;
			this._receivingAll = child.receivingAll;
			this._receivingAny = child.receivingAny;
			this.notifyChange();
		} else {
			this.clearChildState();
			this.notifyChange();
		}
	}

	private clearChildState(): void {
		if (
			this._state !== "completed" &&
			this._state !== "failed" &&
			this._state !== "cancelled"
		) {
			this._state = "running";
		}
		this._receiving = undefined;
		this._receivingAll = undefined;
		this._receivingAny = undefined;
	}

	private findWaitingSeq(): number {
		// The seq of the current receive command is the current seq counter
		return this.seq;
	}

	private hasEvent(type: string): boolean {
		return this.log.events().some((e) => e.type === type);
	}

	async run(): Promise<unknown> {
		if (!this.hasEvent("workflow_started")) {
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
		// runtime, but TS can't unify overloaded return types with `unknown`.
		// biome-ignore lint/suspicious/noExplicitAny: type-erased boundary between InternalWorkflowContext and user-facing WorkflowContext
		const gen = this.workflowFn(this.context as any);

		try {
			let next = gen.next();

			while (!next.done) {
				const descriptor = next.value as Descriptor;
				const command = this.assignSeq(descriptor);
				try {
					const result = await this.executeCommand(command);
					next = gen.next(result);
				} catch (err) {
					next = gen.throw(err);
				}
			}

			this._result = next.value;
			this._state = "completed";
			if (!this.hasEvent("workflow_completed")) {
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
			if (!this.hasEvent("workflow_failed")) {
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

	private assignSeq(descriptor: Descriptor): Command {
		if (descriptor.type === "race" || descriptor.type === "all") {
			// Assign seq to items first, then the container — matches the order
			// in which context methods consumed seq (branches before race/all).
			const items = descriptor.items.map((item) => this.assignSeq(item));
			const seq = ++this.seq;
			return { ...descriptor, items, seq };
		}
		const seq = ++this.seq;
		return { ...descriptor, seq } as Command;
	}

	private async executeCommand(command: Command): Promise<unknown> {
		switch (command.type) {
			case "activity":
				return this.executeActivity(command);
			case "receive":
				return this.executeReceive(command);
			case "sleep":
				return this.executeSleep(command);
			case "child":
				return this.executeChild(command);
			case "published":
				return this.executePublishedCommand(command);
			case "join":
				return this.executeJoinCommand(command);
			case "race":
				return this.executeRace(command);
			case "all":
				return this.executeAll(command);
			case "publish":
				return this.executePublish(command);
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

	private async executeReceive(
		command: Extract<Command, { type: "receive" }>,
	): Promise<unknown> {
		// Check for replay
		const received = this.log.findCompleted(command.seq, "signal_received");
		if (received) {
			return (received as SignalReceivedEvent).payload;
		}

		// Live: pause until signal() is called
		this._state = "waiting";
		this._receiving = command.signal;

		return new Promise((resolve, reject) => {
			this.pendingReceive = { resolve };
			this._pendingReject = reject;
			// Notify after pendingReceive is set so signal() can resolve the promise
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

		const childName = command.name;
		const childOnAppend =
			this.observers.length > 0
				? (event: WorkflowEvent) => {
						for (const obs of this.observers) {
							obs(childName, event);
						}
					}
				: undefined;
		const childLog = new EventLog([], childOnAppend);
		const childInterpreter = new Interpreter(
			command.workflow,
			childLog,
			undefined,
			undefined,
			this.observers,
		);

		this._activeChild = childInterpreter;
		const unsub = childInterpreter.onStateChange(() => this.syncChildState());

		try {
			const result = await new Promise<unknown>((resolve, reject) => {
				this._pendingReject = reject;
				childInterpreter.run().then(resolve, reject);
			});
			this._pendingReject = null;

			unsub();
			this._activeChild = null;
			this.clearChildState();

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
		} catch (err) {
			this._pendingReject = null;
			unsub();
			this._activeChild = null;
			this.clearChildState();
			throw err;
		}
	}

	private async executePublishedCommand(
		command: Extract<Command, { type: "published" }>,
	): Promise<unknown> {
		// Check for replay
		const completed = this.log.findCompleted(
			command.seq,
			"workflow_dependency_published",
		);
		if (completed) {
			return (completed as { result: unknown }).result;
		}

		// Check for replay: failed
		const failed = this.log.findCompleted(
			command.seq,
			"workflow_dependency_failed",
		);
		if (failed) {
			throw new Error((failed as { error: string }).error);
		}

		// Live: require registry
		if (!this.registry) {
			throw new Error(
				"published requires a WorkflowRegistry. Wrap your app in a WorkflowLayerProvider.",
			);
		}

		this.log.append({
			type: "workflow_dependency_started",
			workflowId: command.workflowId,
			seq: command.seq,
			timestamp: Date.now(),
		});

		try {
			const result = await this.registry.waitForPublished(command.workflowId, {
				start: command.start,
				caller: this._workflowId,
				where: command.where,
				afterSeq: command.afterSeq,
			});

			this.log.append({
				type: "workflow_dependency_published",
				workflowId: command.workflowId,
				seq: command.seq,
				result,
				timestamp: Date.now(),
			});

			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const stack = err instanceof Error ? err.stack : undefined;
			this.log.append({
				type: "workflow_dependency_failed",
				workflowId: command.workflowId,
				seq: command.seq,
				error: message,
				stack,
				timestamp: Date.now(),
			});
			throw err;
		}
	}

	private async executeJoinCommand(
		command: Extract<Command, { type: "join" }>,
	): Promise<unknown> {
		// Check for replay: completed
		const completed = this.log.findCompleted(
			command.seq,
			"workflow_dependency_completed",
		);
		if (completed) {
			return (completed as { result: unknown }).result;
		}

		// Check for replay: failed
		const failed = this.log.findCompleted(
			command.seq,
			"workflow_dependency_failed",
		);
		if (failed) {
			throw new Error((failed as { error: string }).error);
		}

		// Live: require registry
		if (!this.registry) {
			throw new Error(
				"join requires a WorkflowRegistry. Wrap your app in a WorkflowLayerProvider.",
			);
		}

		this.log.append({
			type: "workflow_dependency_started",
			workflowId: command.workflowId,
			seq: command.seq,
			timestamp: Date.now(),
		});

		try {
			const result = await this.registry.waitForCompletion(command.workflowId, {
				start: command.start,
				caller: this._workflowId,
			});

			this.log.append({
				type: "workflow_dependency_completed",
				workflowId: command.workflowId,
				seq: command.seq,
				result,
				timestamp: Date.now(),
			});

			return result;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const stack = err instanceof Error ? err.stack : undefined;
			this.log.append({
				type: "workflow_dependency_failed",
				workflowId: command.workflowId,
				seq: command.seq,
				error: message,
				stack,
				timestamp: Date.now(),
			});
			throw err;
		}
	}

	private async executePublish(
		command: Extract<Command, { type: "publish" }>,
	): Promise<void> {
		// Replay path
		const existing = this.log.findCompleted(command.seq, "workflow_published");
		if (existing) {
			this._publishedValue = (existing as { value: unknown }).value;
			return;
		}

		this._publishedValue = command.value;
		this.registry?.publish(this._workflowId!, command.value);
		this.log.append({
			type: "workflow_published",
			value: command.value,
			seq: command.seq,
			timestamp: Date.now(),
		});
		this.notifyChange();
	}

	private async executeAll(
		command: Extract<Command, { type: "all" }>,
	): Promise<unknown[]> {
		// Replay path
		const completed = this.log.findCompleted(command.seq, "all_completed");
		if (completed) {
			return (completed as AllCompletedEvent).results;
		}

		// Live execution
		this.log.append({
			type: "all_started",
			seq: command.seq,
			items: command.items.map((item) => ({ type: item.type })),
			timestamp: Date.now(),
		});

		type BranchState = {
			controller?: AbortController;
			timer?: ReturnType<typeof setTimeout>;
			childInterpreter?: Interpreter;
			childUnsub?: () => void;
		};

		const branchStates: BranchState[] = command.items.map(() => ({}));
		const allWaiters: Array<{
			signal: string;
			resolve: (payload: unknown) => void;
		}> = [];

		const cleanupAll = () => {
			for (const state of branchStates) {
				state.controller?.abort();
				if (state.timer != null) clearTimeout(state.timer);
				state.childInterpreter?.cancel();
				state.childUnsub?.();
			}
			this._allWaiters = null;
			this._receivingAll = undefined;
		};

		const branchPromises = command.items.map((item, index) => {
			const state = branchStates[index];

			switch (item.type) {
				case "activity": {
					return this.executeActivity(item).then((value) => ({
						index,
						value,
					}));
				}
				case "sleep": {
					return new Promise<{ index: number; value: unknown }>((resolve) => {
						state.timer = setTimeout(() => {
							resolve({ index, value: undefined });
						}, item.durationMs);
					});
				}
				case "receive": {
					return new Promise<{ index: number; value: unknown }>((resolve) => {
						allWaiters.push({
							signal: item.signal,
							resolve: (payload: unknown) => {
								resolve({ index, value: payload });
							},
						});
					});
				}
				case "published": {
					return this.executePublishedCommand(item).then((value) => ({
						index,
						value,
					}));
				}
				case "join": {
					return this.executeJoinCommand(item).then((value) => ({
						index,
						value,
					}));
				}
				case "child": {
					const childName = item.name;
					const childOnAppend =
						this.observers.length > 0
							? (event: WorkflowEvent) => {
									for (const obs of this.observers) {
										obs(childName, event);
									}
								}
							: undefined;
					const childLog = new EventLog([], childOnAppend);
					const childInterpreter = new Interpreter(
						item.workflow,
						childLog,
						undefined,
						undefined,
						this.observers,
					);
					state.childInterpreter = childInterpreter;

					const unsub = childInterpreter.onStateChange(() =>
						this.syncChildState(),
					);
					state.childUnsub = unsub;

					return childInterpreter.run().then((result) => {
						unsub();
						if (childInterpreter.state === "failed") {
							throw new Error(
								childInterpreter.error ?? "Child workflow failed",
							);
						}
						return { index, value: result };
					});
				}
				case "race": {
					return this.executeRace(item).then((value) => ({
						index,
						value,
					}));
				}
				case "all": {
					return this.executeAll(item).then((value) => ({
						index,
						value,
					}));
				}
				case "publish": {
					throw new Error("publish cannot be used inside an all branch");
				}
				default: {
					const _exhaustive: never = item;
					throw new Error(
						`Unsupported command type in all: ${(_exhaustive as Command).type}`,
					);
				}
			}
		});

		// Expose signal-based all branches for signal routing
		if (allWaiters.length > 0) {
			this._allWaiters = allWaiters;
			this._state = "waiting";
			this._receivingAll = allWaiters.map((w) => w.signal);
			this.notifyChange();
		}

		// Also race against cancellation
		const cancelPromise = new Promise<never>((_, reject) => {
			this._pendingReject = reject;
		});

		try {
			const results = await Promise.race([
				Promise.all(branchPromises),
				cancelPromise,
			]);

			this._pendingReject = null;
			this._allWaiters = null;
			this._receivingAll = undefined;
			this._state = "running";

			// Sort by index to preserve declaration order
			const ordered = (results as Array<{ index: number; value: unknown }>)
				.sort((a, b) => a.index - b.index)
				.map((r) => r.value);

			this.log.append({
				type: "all_completed",
				seq: command.seq,
				results: ordered,
				timestamp: Date.now(),
			});

			return ordered;
		} catch (err) {
			this._pendingReject = null;
			cleanupAll();
			throw err;
		}
	}

	private async executeRace(
		command: Extract<Command, { type: "race" }>,
	): Promise<{ winner: number; value: unknown }> {
		// Replay path
		const completed = this.log.findCompleted(command.seq, "race_completed");
		if (completed) {
			const event = completed as RaceCompletedEvent;
			return { winner: event.winner, value: event.value };
		}

		// Live execution
		this.log.append({
			type: "race_started",
			seq: command.seq,
			items: command.items.map((item) => ({ type: item.type })),
			timestamp: Date.now(),
		});

		type BranchState = {
			controller?: AbortController;
			timer?: ReturnType<typeof setTimeout>;
			childInterpreter?: Interpreter;
			childUnsub?: () => void;
		};

		const branchStates: BranchState[] = command.items.map(() => ({}));
		const raceWaiters: Array<{
			signal: string;
			resolve: (payload: unknown) => void;
		}> = [];

		const cleanupAll = () => {
			for (const state of branchStates) {
				state.controller?.abort();
				if (state.timer != null) clearTimeout(state.timer);
				state.childInterpreter?.cancel();
				state.childUnsub?.();
			}
			this._raceWaiters = null;
			this._receiving = undefined;
			this.pendingReceive = undefined;
			this._receivingAny = undefined;
			this._raceCleanup = null;
		};

		this._raceCleanup = cleanupAll;

		const branchPromises = command.items.map((item, index) => {
			const state = branchStates[index];

			switch (item.type) {
				case "activity": {
					const controller = new AbortController();
					state.controller = controller;
					return item.fn(controller.signal).then((value) => ({ index, value }));
				}
				case "sleep": {
					return new Promise<{ index: number; value: unknown }>((resolve) => {
						state.timer = setTimeout(() => {
							resolve({ index, value: undefined });
						}, item.durationMs);
					});
				}
				case "receive": {
					return new Promise<{ index: number; value: unknown }>((resolve) => {
						raceWaiters.push({
							signal: item.signal,
							resolve: (payload: unknown) => {
								// Immediately clear race waiters to prevent stale
								// resolution when ctx.handle() loops and a signal arrives
								// before the next race is set up.
								this._raceWaiters = null;
								this._state = "running";
								resolve({ index, value: payload });
							},
						});
					});
				}
				case "child": {
					const raceChildName = item.name;
					const raceChildOnAppend =
						this.observers.length > 0
							? (event: WorkflowEvent) => {
									for (const obs of this.observers) {
										obs(raceChildName, event);
									}
								}
							: undefined;
					const childLog = new EventLog([], raceChildOnAppend);
					const childInterpreter = new Interpreter(
						item.workflow,
						childLog,
						undefined,
						undefined,
						this.observers,
					);
					state.childInterpreter = childInterpreter;

					this._activeChild = childInterpreter;
					const unsub = childInterpreter.onStateChange(() =>
						this.syncChildState(),
					);
					state.childUnsub = unsub;

					return childInterpreter.run().then((result) => {
						unsub();
						if (this._activeChild === childInterpreter) {
							this._activeChild = null;
							this.clearChildState();
						}
						if (childInterpreter.state === "failed") {
							throw new Error(
								childInterpreter.error ?? "Child workflow failed",
							);
						}
						return { index, value: result };
					});
				}
				case "published": {
					return this.executePublishedCommand(item).then((value) => ({
						index,
						value,
					}));
				}
				case "join": {
					return this.executeJoinCommand(item).then((value) => ({
						index,
						value,
					}));
				}
				case "race": {
					return this.executeRace(item).then((value) => ({
						index,
						value,
					}));
				}
				case "all": {
					return this.executeAll(item).then((value) => ({
						index,
						value,
					}));
				}
				case "publish": {
					throw new Error("publish cannot be used inside a race branch");
				}
				default: {
					const _exhaustive: never = item;
					throw new Error(
						`Unsupported command type in race: ${(_exhaustive as Command).type}`,
					);
				}
			}
		});

		// Expose signal-based race branches for signal routing
		if (raceWaiters.length > 0) {
			this._raceWaiters = raceWaiters;
			this._state = "waiting";
			this._receivingAny = raceWaiters.map((w) => w.signal);
			this.notifyChange();
		}

		// Also race against cancellation
		const cancelPromise = new Promise<never>((_, reject) => {
			this._pendingReject = reject;
		});

		const raceResult = await Promise.race([...branchPromises, cancelPromise]);

		this._pendingReject = null;

		// Clean up losing branches
		for (let i = 0; i < branchStates.length; i++) {
			if (i === raceResult.index) continue;
			const state = branchStates[i];
			state.controller?.abort();
			if (state.timer != null) clearTimeout(state.timer);
			state.childInterpreter?.cancel();
			state.childUnsub?.();
		}

		this._raceWaiters = null;
		this._receiving = undefined;
		this.pendingReceive = undefined;
		this._receivingAny = undefined;
		if (this._activeChild) {
			this._activeChild = null;
			this.clearChildState();
		}
		this._state = "running";
		this._raceCleanup = null;

		this.log.append({
			type: "race_completed",
			seq: command.seq,
			winner: raceResult.index,
			value: raceResult.value,
			timestamp: Date.now(),
		});

		return { winner: raceResult.index, value: raceResult.value };
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

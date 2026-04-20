// ABOUTME: Core workflow interpreter that drives generator-based workflows.
// ABOUTME: Executes commands, records events, and supports replay from event log.

import { EventLog } from "./event-log";
import {
	type ActivityScheduledEvent,
	type AllCompletedEvent,
	type AnyWorkflow,
	CancelledError,
	type Command,
	type Descriptor,
	type RaceCompletedEvent,
	type ReceiveResolvedEvent,
	type WorkflowCancelledEvent,
	type WorkflowCompletedEvent,
	type WorkflowEvent,
	type WorkflowEventObserver,
	type WorkflowFailedEvent,
	type WorkflowRegistryInterface,
	type InterpreterStatus,
	type WorkflowState,
	Workflow,
} from "./types";

export class Interpreter {
	private _workflow: AnyWorkflow;
	private log: EventLog;
	private seq = 0;
	private _status: InterpreterStatus = "running";
	private _result: unknown;
	private _error: string | undefined;
	private _receiving: string | undefined;
	private _receivingType: "query" | undefined;
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
		wf: AnyWorkflow,
		log: EventLog,
		registry?: WorkflowRegistryInterface,
		workflowId?: string,
		observers?: WorkflowEventObserver[],
	) {
		this._workflow = wf;
		this.log = log;
		this.registry = registry;
		this._workflowId = workflowId;
		this.observers = observers ?? [];
		this.seq = 0;
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

	get status(): InterpreterStatus {
		return this._status;
	}

	get state(): WorkflowState {
		switch (this._status) {
			case "completed":
				return { status: "completed", result: this._result };
			case "failed":
				return { status: "failed", error: this._error! };
			case "cancelled":
				return { status: "cancelled" };
			case "waiting":
				return { status: "waiting" };
			case "running":
				return { status: "running" };
		}
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
		// query branch and a child branch, and the bare query needs
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

		if (this._status !== "waiting") return;

		// Single query path
		if (this._receiving === name) {
			const seq = this.findWaitingSeq();
			this.log.append({
				type: "receive_resolved",
				label: name,
				value: payload,
				seq,
				timestamp: Date.now(),
			});
			this._status = "running";
			this._receiving = undefined;
			this._receivingType = undefined;
			this.notifyChange();
			this.pendingReceive?.resolve(payload);
			this.pendingReceive = undefined;
			return;
		}
	}

	cancel(): void {
		if (
			this._status === "completed" ||
			this._status === "failed" ||
			this._status === "cancelled"
		) {
			return;
		}

		this._status = "cancelled";
		this.log.append({ type: "workflow_cancelled", timestamp: Date.now() });

		// Cancel active child
		this._activeChild?.cancel();
		this._activeChild = null;

		// Abort in-flight activity
		this._abortController?.abort();
		this._abortController = null;

		// Reject pending query/sleep
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

		if (child.status === "waiting") {
			this._status = "waiting";
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
			this._status !== "completed" &&
			this._status !== "failed" &&
			this._status !== "cancelled"
		) {
			this._status = "running";
		}
		this._receiving = undefined;
		this._receivingAll = undefined;
		this._receivingAny = undefined;
	}

	private findWaitingSeq(): number {
		// The seq of the current query command is the current seq counter
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
				this._status = "completed";
				this._result = completed.result;
				this.notifyChange();
				return this._result;
			}
			const failed = events.find(
				(e): e is WorkflowFailedEvent => e.type === "workflow_failed",
			);
			if (failed) {
				this._status = "failed";
				this._error = failed.error;
				this.notifyChange();
				return undefined;
			}
			const cancelled = events.find(
				(e): e is WorkflowCancelledEvent => e.type === "workflow_cancelled",
			);
			if (cancelled) {
				this._status = "cancelled";
				this.notifyChange();
				return undefined;
			}

			this.log.append({ type: "workflow_started", timestamp: Date.now() });
		}

		const gen = this._workflow.createGenerator();

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
			this._status = "completed";
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
			this._status = "failed";
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
			case "sleep":
				return this.executeSleep(command);
			case "child":
				return this.executeChild(command);
			case "race":
				return this.executeRace(command);
			case "all":
				return this.executeAll(command);
			case "publish":
				return this.executePublish(command);
			case "loop":
				return this.executeLoop(command);
			case "loop_break":
				return this.executeLoopBreak(command);
			case "query":
				return this.executeQuery(command);
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

	private async executeQuery(
		command: Extract<Command, { type: "query" }>,
	): Promise<unknown> {
		// Replay: signal-resolved query returns the cached value.
		const signalResolved = this.log.findCompleted(command.seq, "receive_resolved");
		if (signalResolved) {
			if (this.registry?.has(command.label)) {
				throw new Error(
					`Log at seq ${command.seq} has a receive_resolved event for "${command.label}" which is now a registered workflow. This log was written under a prior event-schema version; clear the log to reset.`,
				);
			}
			return (signalResolved as ReceiveResolvedEvent).value;
		}

		// Replay: workflow-resolved query re-hydrates via the registry. The marker
		// event has no value; ask the registry for the current hydrated value.
		const workflowMarker = this.log.findCompleted(
			command.seq,
			"read_resolved",
		);
		if (workflowMarker) {
			if (!this.registry?.has(command.label)) {
				throw new Error(
					`Cannot replay workflow query "${command.label}": registry has no entry. Did the registry change between runs?`,
				);
			}
			return this.registry.waitFor(command.label, {
				start: true,
				caller: this._workflowId,
			});
		}

		// Self-reference detection: a workflow cannot query its own output
		if (command.label === this._workflowId) {
			throw new Error(
				`Workflow "${this._workflowId}" cannot query itself. Use a different label or restructure the dependency.`,
			);
		}

		// Auto-match: if the registry has a workflow with this label, use waitFor
		// and record a marker-only event. The value is never serialized to the log —
		// it re-hydrates via the registry on every replay.
		if (this.registry?.has(command.label)) {
			try {
				const result = await this.registry.waitFor(command.label, {
					start: true,
					caller: this._workflowId,
				});

				this.log.append({
					type: "read_resolved",
					label: command.label,
					seq: command.seq,
					timestamp: Date.now(),
				});

				return result;
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(message);
			}
		}

		// No registry match: pause until signal() is called with this label
		this._status = "waiting";
		this._receiving = command.label;
		this._receivingType = "query";

		return new Promise((resolve, reject) => {
			this.pendingReceive = { resolve };
			this._pendingReject = reject;
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

			if (childInterpreter.status === "failed") {
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

	private async executeLoop(
		command: Extract<Command, { type: "loop" }>,
	): Promise<unknown> {
		// Replay path
		const completed = this.log.findCompleted(command.seq, "loop_completed");
		if (completed) {
			return (completed as { value: unknown }).value;
		}

		this.log.append({
			type: "loop_started",
			seq: command.seq,
			timestamp: Date.now(),
		});

		for (;;) {
			const bodyGen = command.body();
			let next = bodyGen.next();
			while (!next.done) {
				const desc = next.value as Descriptor;
				const cmd = this.assignSeq(desc);
				if (cmd.type === "loop_break") {
					const value = cmd.value;
					this.log.append({
						type: "loop_completed",
						seq: command.seq,
						value,
						timestamp: Date.now(),
					});
					return value;
				}
				const result = await this.executeCommand(cmd);
				next = bodyGen.next(result);
			}
			// Body completed without loopBreak — iterate again
		}
	}

	private async executeLoopBreak(
		_command: Extract<Command, { type: "loop_break" }>,
	): Promise<never> {
		throw new Error("loopBreak must be used inside a loop");
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
						if (childInterpreter.status === "failed") {
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
				case "loop": {
					throw new Error("loop cannot be used inside an all branch");
				}
				case "loop_break": {
					throw new Error("loop_break cannot be used inside an all branch");
				}
				case "query": {
					// Replay: signal-resolved query returns the cached value.
					const queryResolved = this.log.findCompleted(
						item.seq,
						"receive_resolved",
					);
					if (queryResolved) {
						if (this.registry?.has(item.label)) {
							return Promise.reject(new Error(
								`Log at seq ${item.seq} has a receive_resolved event for "${item.label}" which is now a registered workflow. This log was written under a prior event-schema version; clear the log to reset.`,
							));
						}
						return Promise.resolve({
							index,
							value: (queryResolved as ReceiveResolvedEvent).value,
						});
					}

					// Replay: workflow-resolved query re-hydrates via the registry.
					const workflowMarker = this.log.findCompleted(
						item.seq,
						"read_resolved",
					);
					if (workflowMarker) {
						if (!this.registry?.has(item.label)) {
							return Promise.reject(new Error(
								`Cannot replay workflow query "${item.label}": registry has no entry.`,
							));
						}
						return this.registry.waitFor(item.label, {
							start: true,
							caller: this._workflowId,
						}).then((value) => ({ index, value }));
					}

					// Self-reference check
					if (item.label === this._workflowId) {
						return Promise.reject(new Error(
							`Workflow "${this._workflowId}" cannot query itself. Use a different label or restructure the dependency.`,
						));
					}

					// Auto-match registry: record a marker, never cache the value.
					if (this.registry?.has(item.label)) {
						return this.registry.waitFor(item.label, {
							start: true,
							caller: this._workflowId,
						}).then((result) => {
							this.log.append({
								type: "read_resolved",
								label: item.label,
								seq: item.seq,
								timestamp: Date.now(),
							});
							return { index, value: result };
						});
					}

					// No registry match: wait for signal
					return new Promise<{ index: number; value: unknown }>((resolve) => {
						allWaiters.push({
							signal: item.label,
							resolve: (payload: unknown) => {
								this.log.append({
									type: "receive_resolved",
									label: item.label,
									value: payload,
									seq: item.seq,
									timestamp: Date.now(),
								});
								resolve({ index, value: payload });
							},
						});
					});
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
			this._status = "waiting";
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
			this._status = "running";

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
						if (childInterpreter.status === "failed") {
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
					throw new Error("publish cannot be used inside a race branch");
				}
				case "loop": {
					return this.executeLoop(item).then((value) => ({
						index,
						value,
					}));
				}
				case "loop_break": {
					throw new Error("loop_break cannot be used inside a race branch");
				}
				case "query": {
					// Replay: signal-resolved query returns the cached value.
					const queryResolved = this.log.findCompleted(
						item.seq,
						"receive_resolved",
					);
					if (queryResolved) {
						if (this.registry?.has(item.label)) {
							return Promise.reject(new Error(
								`Log at seq ${item.seq} has a receive_resolved event for "${item.label}" which is now a registered workflow. This log was written under a prior event-schema version; clear the log to reset.`,
							));
						}
						return Promise.resolve({
							index,
							value: (queryResolved as ReceiveResolvedEvent).value,
						});
					}

					// Replay: workflow-resolved query re-hydrates via the registry.
					const workflowMarker = this.log.findCompleted(
						item.seq,
						"read_resolved",
					);
					if (workflowMarker) {
						if (!this.registry?.has(item.label)) {
							return Promise.reject(new Error(
								`Cannot replay workflow query "${item.label}": registry has no entry.`,
							));
						}
						return this.registry.waitFor(item.label, {
							start: true,
							caller: this._workflowId,
						}).then((value) => ({ index, value }));
					}

					// Self-reference check
					if (item.label === this._workflowId) {
						return Promise.reject(new Error(
							`Workflow "${this._workflowId}" cannot query itself. Use a different label or restructure the dependency.`,
						));
					}

					// Auto-match registry: record a marker, never cache the value.
					if (this.registry?.has(item.label)) {
						return this.registry.waitFor(item.label, {
							start: true,
							caller: this._workflowId,
						}).then((result) => {
							this.log.append({
								type: "read_resolved",
								label: item.label,
								seq: item.seq,
								timestamp: Date.now(),
							});
							return { index, value: result };
						});
					}

					// No registry match: wait for signal
					return new Promise<{ index: number; value: unknown }>(
						(resolve) => {
							raceWaiters.push({
								signal: item.label,
								resolve: (payload: unknown) => {
									this._raceWaiters = null;
									this._status = "running";
									this.log.append({
										type: "receive_resolved",
										label: item.label,
										value: payload,
										seq: item.seq,
										timestamp: Date.now(),
									});
									resolve({ index, value: payload });
								},
							});
						},
					);
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
			this._status = "waiting";
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
		this._status = "running";
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

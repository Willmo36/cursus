// ABOUTME: Manages shared workflow instances with waiter resolution and storage persistence.
// ABOUTME: Allows workflows to depend on each other's results via waitFor.

import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import type {
	AnyWorkflowFunction,
	WorkflowEvent,
	WorkflowRegistryInterface,
	WorkflowState,
	WorkflowStorage,
} from "./types";

type WorkflowEntry = {
	fn: AnyWorkflowFunction;
	interpreter?: Interpreter;
	result?: unknown;
	completed: boolean;
	failed: boolean;
	error?: string;
	observed: boolean;
	waiters: Array<{
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
	}>;
	listeners: Array<() => void>;
};

export class WorkflowRegistry implements WorkflowRegistryInterface {
	private entries: Map<string, WorkflowEntry>;
	private _storage: WorkflowStorage;
	private workflowChangeListeners: Array<() => void> = [];

	constructor(
		workflows: Record<string, AnyWorkflowFunction>,
		storage: WorkflowStorage,
	) {
		this._storage = storage;
		this.entries = new Map();
		for (const [id, fn] of Object.entries(workflows)) {
			this.entries.set(id, {
				fn,
				completed: false,
				failed: false,
				observed: false,
				waiters: [],
				listeners: [],
			});
		}
	}

	get storage(): WorkflowStorage {
		return this._storage;
	}

	private getEntry(id: string): WorkflowEntry {
		const entry = this.entries.get(id);
		if (!entry) {
			throw new Error(`Workflow "${id}" is not registered`);
		}
		return entry;
	}

	async start(id: string): Promise<void> {
		const entry = this.getEntry(id);

		// Idempotent — no-op if already started
		if (entry.interpreter) return;

		const events = await this._storage.load(id);
		const log = new EventLog(events);
		let persistedCount = events.length;

		const interpreter = new Interpreter(entry.fn, log, this);
		entry.interpreter = interpreter;

		const persistEvents = async () => {
			const allEvents = log.events();
			const newEvents = allEvents.slice(persistedCount);
			if (newEvents.length > 0) {
				await this._storage.append(id, newEvents);
				persistedCount = allEvents.length;
			}
		};

		interpreter.onStateChange(() => {
			persistEvents();
			for (const listener of entry.listeners) {
				listener();
			}
		});

		await interpreter.run();

		// Persist final events
		await persistEvents();

		// Compact storage for terminal workflows — only the terminal event matters on reload
		if (interpreter.state === "completed" || interpreter.state === "failed") {
			const allEvents = log.events();
			const terminalEvent = allEvents
				.slice()
				.reverse()
				.find(
					(e) =>
						e.type === "workflow_completed" || e.type === "workflow_failed",
				);
			if (terminalEvent) {
				await this._storage.compact(id, [terminalEvent]);
			}
		}

		if (interpreter.state === "completed") {
			entry.completed = true;
			entry.result = interpreter.result;
			for (const waiter of entry.waiters) {
				waiter.resolve(interpreter.result);
			}
			entry.waiters = [];
		} else if (interpreter.state === "failed") {
			entry.failed = true;
			entry.error = interpreter.error;
			for (const waiter of entry.waiters) {
				waiter.reject(new Error(interpreter.error ?? "Workflow failed"));
			}
			entry.waiters = [];
		}
	}

	async waitFor<T>(id: string, options?: { start?: boolean }): Promise<T> {
		const entry = this.getEntry(id);
		const shouldStart = options?.start ?? true;

		// Already completed
		if (entry.completed) {
			return entry.result as T;
		}

		// Already failed
		if (entry.failed) {
			throw new Error(entry.error ?? "Workflow failed");
		}

		// Not started yet — auto-start if requested
		if (!entry.interpreter && shouldStart) {
			await this.start(id);
			// After start completes, entry should be completed or failed
			if (entry.completed) return entry.result as T;
			if (entry.failed) throw new Error(entry.error ?? "Workflow failed");
		}

		// Still running or not started — add a waiter
		return new Promise<T>((resolve, reject) => {
			entry.waiters.push({
				resolve: resolve as (value: unknown) => void,
				reject,
			});
		});
	}

	async reset(id: string): Promise<void> {
		const entry = this.getEntry(id);

		entry.interpreter?.cancel();
		entry.interpreter = undefined;
		entry.completed = false;
		entry.failed = false;
		entry.result = undefined;
		entry.error = undefined;

		await this._storage.clear(id);

		for (const listener of entry.listeners) {
			listener();
		}
	}

	signal(id: string, name: string, payload?: unknown): void {
		const entry = this.getEntry(id);
		entry.interpreter?.signal(name, payload);
	}

	getEvents(id: string): WorkflowEvent[] {
		const entry = this.entries.get(id);
		if (!entry?.interpreter) return [];
		return entry.interpreter.events;
	}

	getWorkflowIds(): string[] {
		return [...this.entries.keys()];
	}

	getInterpreter(id: string): Interpreter | undefined {
		return this.entries.get(id)?.interpreter;
	}

	getState(id: string): WorkflowState | undefined {
		return this.entries.get(id)?.interpreter?.state;
	}

	observe(id: string, interpreter: Interpreter): void {
		const existing = this.entries.get(id);
		if (existing && !existing.observed) return;
		if (existing) {
			existing.interpreter = interpreter;
			interpreter.onStateChange(() => {
				for (const listener of existing.listeners) {
					listener();
				}
			});
			return;
		}
		const entry: WorkflowEntry = {
			fn: (() => {}) as unknown as AnyWorkflowFunction,
			interpreter,
			completed: false,
			failed: false,
			observed: true,
			waiters: [],
			listeners: [],
		};
		this.entries.set(id, entry);
		interpreter.onStateChange(() => {
			for (const listener of entry.listeners) {
				listener();
			}
		});
		this.notifyWorkflowsChange();
	}

	unobserve(id: string): void {
		this.entries.delete(id);
		this.notifyWorkflowsChange();
	}

	onWorkflowsChange(callback: () => void): () => void {
		this.workflowChangeListeners.push(callback);
		return () => {
			const idx = this.workflowChangeListeners.indexOf(callback);
			if (idx !== -1) this.workflowChangeListeners.splice(idx, 1);
		};
	}

	private notifyWorkflowsChange(): void {
		for (const listener of this.workflowChangeListeners) {
			listener();
		}
	}

	onStateChange(id: string, callback: () => void): () => void {
		const entry = this.entries.get(id);
		if (!entry) {
			throw new Error(`Workflow "${id}" is not registered`);
		}
		entry.listeners.push(callback);
		return () => {
			const idx = entry.listeners.indexOf(callback);
			if (idx !== -1) {
				entry.listeners.splice(idx, 1);
			}
		};
	}
}

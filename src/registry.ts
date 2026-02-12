// ABOUTME: Manages shared workflow instances with waiter resolution and storage persistence.
// ABOUTME: Allows workflows to depend on each other's results via waitFor.

import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import type {
	AnyWorkflowFunction,
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
	waiters: Array<{
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
	}>;
	listeners: Array<() => void>;
};

export class WorkflowRegistry implements WorkflowRegistryInterface {
	private entries: Map<string, WorkflowEntry>;
	private storage: WorkflowStorage;

	constructor(
		workflows: Record<string, AnyWorkflowFunction>,
		storage: WorkflowStorage,
	) {
		this.storage = storage;
		this.entries = new Map();
		for (const [id, fn] of Object.entries(workflows)) {
			this.entries.set(id, {
				fn,
				completed: false,
				failed: false,
				waiters: [],
				listeners: [],
			});
		}
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

		const events = await this.storage.load(id);
		const log = new EventLog(events);
		let persistedCount = events.length;

		const interpreter = new Interpreter(entry.fn, log, this);
		entry.interpreter = interpreter;

		const persistEvents = async () => {
			const allEvents = log.events();
			const newEvents = allEvents.slice(persistedCount);
			if (newEvents.length > 0) {
				await this.storage.append(id, newEvents);
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

	signal(id: string, name: string, payload?: unknown): void {
		const entry = this.getEntry(id);
		entry.interpreter?.signal(name, payload);
	}

	getInterpreter(id: string): Interpreter | undefined {
		return this.entries.get(id)?.interpreter;
	}

	getState(id: string): WorkflowState | undefined {
		return this.entries.get(id)?.interpreter?.state;
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

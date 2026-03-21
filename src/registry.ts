// ABOUTME: Manages shared workflow instances with waiter resolution and storage persistence.
// ABOUTME: Allows workflows to depend on each other's results via waitFor.

import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import { checkVersion } from "./storage";
import {
	type AnyWorkflow,
	type WorkflowEvent,
	type WorkflowEventObserver,
	type WorkflowRegistryInterface,
	type WorkflowState,
	type WorkflowStorage,
	type WorkflowTrace,
	Workflow,
} from "./types";
import { EVENT_SCHEMA_VERSION, LIBRARY_VERSION } from "./version";

type Waiter = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	where?: (value: unknown) => boolean;
};

type WorkflowEntry = {
	workflow: AnyWorkflow;
	storage: WorkflowStorage;
	interpreter?: Interpreter;
	result?: unknown;
	completed: boolean;
	failed: boolean;
	error?: string;
	published: boolean;
	publishedValue?: unknown;
	publishSeq: number;
	observed: boolean;
	waiters: Waiter[];
	listeners: Array<() => void>;
};

export class WorkflowRegistry<K extends string = string>
	implements WorkflowRegistryInterface
{
	private entries: Map<string, WorkflowEntry>;
	private _defaultStorage: WorkflowStorage;
	private workflowChangeListeners: Array<() => void> = [];
	private deps = new Map<string, Set<string>>();
	private observers: WorkflowEventObserver[];
	private versions?: Partial<Record<K, number>>;

	constructor(
		workflows: Record<K, AnyWorkflow>,
		storage: WorkflowStorage,
		options?: {
			observers?: WorkflowEventObserver[];
			versions?: Partial<Record<K, number>>;
			storageMap?: Record<string, WorkflowStorage>;
		},
	) {
		this._defaultStorage = storage;
		this.observers = options?.observers ?? [];
		this.versions = options?.versions;
		this.entries = new Map();
		for (const [id, wf] of Object.entries(workflows) as [
			string,
			AnyWorkflow,
		][]) {
			this.entries.set(id, {
				workflow: wf,
				storage: options?.storageMap?.[id] ?? storage,
				completed: false,
				failed: false,
				published: false,
				publishSeq: 0,
				observed: false,
				waiters: [],
				listeners: [],
			});
		}
	}

	get storage(): WorkflowStorage {
		return this._defaultStorage;
	}

	has(id: string): boolean {
		return this.entries.has(id);
	}

	private getEntry(id: string): WorkflowEntry {
		const entry = this.entries.get(id);
		if (!entry) {
			throw new Error(`Workflow "${id}" is not registered`);
		}
		return entry;
	}

	private addDependency(caller: string, target: string): void {
		let edges = this.deps.get(caller);
		if (!edges) {
			edges = new Set();
			this.deps.set(caller, edges);
		}
		edges.add(target);

		// DFS from target following outgoing edges, looking for caller
		const visited = new Set<string>();
		const path = [caller, target];
		const hasCycle = (node: string): boolean => {
			if (node === caller) return true;
			if (visited.has(node)) return false;
			visited.add(node);
			const next = this.deps.get(node);
			if (!next) return false;
			for (const neighbor of next) {
				path.push(neighbor);
				if (hasCycle(neighbor)) return true;
				path.pop();
			}
			return false;
		};

		if (hasCycle(target)) {
			// Remove the edge we just added before throwing
			edges.delete(target);
			if (edges.size === 0) this.deps.delete(caller);
			throw new Error(`Circular dependency detected: ${path.join(" -> ")}`);
		}
	}

	private removeDependency(id: string): void {
		this.deps.delete(id);
	}

	async start(id: string): Promise<void> {
		const entry = this.getEntry(id);

		// Idempotent — no-op if already started
		if (entry.interpreter) return;

		await checkVersion(entry.storage, id, this.versions?.[id as K]);
		const events = await entry.storage.load(id);
		const onAppend =
			this.observers.length > 0
				? (event: WorkflowEvent) => {
						for (const obs of this.observers) {
							obs(id, event);
						}
					}
				: undefined;
		const log = new EventLog(events, onAppend);
		let persistedCount = events.length;

		const interpreter = new Interpreter(
			entry.workflow,
			log,
			this,
			id,
			this.observers,
		);
		entry.interpreter = interpreter;

		const persistEvents = async () => {
			const allEvents = log.events();
			const newEvents = allEvents.slice(persistedCount);
			if (newEvents.length > 0) {
				await entry.storage.append(id, newEvents);
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

		// Compact storage for terminal workflows — keep published + terminal events for reload
		if (interpreter.status === "completed" || interpreter.status === "failed") {
			const allEvents = log.events();
			const compacted: WorkflowEvent[] = [];
			const publishedEvent = allEvents
				.slice()
				.reverse()
				.find((e) => e.type === "workflow_published");
			if (publishedEvent) {
				compacted.push(publishedEvent);
			}
			const terminalEvent = allEvents
				.slice()
				.reverse()
				.find(
					(e) =>
						e.type === "workflow_completed" || e.type === "workflow_failed",
				);
			if (terminalEvent) {
				compacted.push(terminalEvent);
			}
			if (compacted.length > 0) {
				await entry.storage.compact(id, compacted);
			}
		}

		// Hydrate published state from persisted events (survives compaction)
		const publishedEvent = log
			.events()
			.slice()
			.reverse()
			.find((e) => e.type === "workflow_published");
		if (publishedEvent && publishedEvent.type === "workflow_published") {
			entry.published = true;
			entry.publishedValue = publishedEvent.value;
		}

		if (interpreter.status === "completed") {
			entry.completed = true;
			entry.result = interpreter.result;
			this.removeDependency(id);
			for (const waiter of entry.waiters) {
				waiter.resolve(
					entry.published ? entry.publishedValue : interpreter.result,
				);
			}
			entry.waiters = [];
		} else if (interpreter.status === "failed") {
			entry.failed = true;
			entry.error = interpreter.error;
			this.removeDependency(id);
			const err = new Error(interpreter.error ?? "Workflow failed");
			for (const waiter of entry.waiters) {
				waiter.reject(err);
			}
			entry.waiters = [];
		}
	}

	async waitFor<T>(
		id: string,
		options?: { start?: boolean; caller?: string },
	): Promise<T> {
		const entry = this.getEntry(id);
		const shouldStart = options?.start ?? true;
		const caller = options?.caller;

		// Already published (workflow still running but has a value for consumers)
		if (entry.published) {
			return entry.publishedValue as T;
		}

		// Already completed
		if (entry.completed) {
			return entry.result as T;
		}

		// Already failed
		if (entry.failed) {
			throw new Error(entry.error ?? "Workflow failed");
		}

		// Check for circular dependencies before proceeding
		if (caller) {
			this.addDependency(caller, id);
		}

		// Not started yet — auto-start if requested
		if (!entry.interpreter && shouldStart) {
			await this.start(id);
			if (entry.published) return entry.publishedValue as T;
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

	publish(id: string, value: unknown): void {
		const entry = this.getEntry(id);
		entry.published = true;
		entry.publishedValue = value;
		entry.publishSeq++;
		for (const waiter of entry.waiters) {
			waiter.resolve(value);
		}
		entry.waiters = [];
	}

	getPublishSeq(id: string): number {
		return this.getEntry(id).publishSeq;
	}

	async reset(id: string): Promise<void> {
		const entry = this.getEntry(id);

		entry.interpreter?.cancel();
		entry.interpreter = undefined;
		entry.completed = false;
		entry.failed = false;
		entry.published = false;
		entry.publishedValue = undefined;
		entry.publishSeq = 0;
		entry.result = undefined;
		entry.error = undefined;
		this.removeDependency(id);

		await entry.storage.clear(id);

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

	getTrace(id: string): WorkflowTrace {
		return {
			schemaVersion: EVENT_SCHEMA_VERSION,
			libraryVersion: LIBRARY_VERSION,
			workflowId: id,
			events: this.getEvents(id),
		};
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
			workflow: new Workflow(() => (function* () {})()),
			storage: this._defaultStorage,
			interpreter,
			completed: false,
			failed: false,
			published: false,
			publishSeq: 0,
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

// ABOUTME: Pluggable storage implementations for persisting workflow event logs.
// ABOUTME: Provides in-memory storage for tests and localStorage for browser persistence.

import type { WorkflowEvent, WorkflowStorage } from "./types";

export class MemoryStorage implements WorkflowStorage {
	private store = new Map<string, WorkflowEvent[]>();

	async load(workflowId: string): Promise<WorkflowEvent[]> {
		return [...(this.store.get(workflowId) ?? [])];
	}

	async append(workflowId: string, events: WorkflowEvent[]): Promise<void> {
		const existing = this.store.get(workflowId) ?? [];
		this.store.set(workflowId, [...existing, ...events]);
	}

	async compact(workflowId: string, events: WorkflowEvent[]): Promise<void> {
		this.store.set(workflowId, [...events]);
	}

	async clear(workflowId: string): Promise<void> {
		this.store.delete(workflowId);
	}
}

export class LocalStorage implements WorkflowStorage {
	private prefix: string;

	constructor(prefix = "react-workflow") {
		this.prefix = prefix;
	}

	private key(workflowId: string): string {
		return `${this.prefix}:${workflowId}`;
	}

	async load(workflowId: string): Promise<WorkflowEvent[]> {
		const raw = localStorage.getItem(this.key(workflowId));
		if (!raw) return [];
		return JSON.parse(raw) as WorkflowEvent[];
	}

	async append(workflowId: string, events: WorkflowEvent[]): Promise<void> {
		const existing = await this.load(workflowId);
		localStorage.setItem(
			this.key(workflowId),
			JSON.stringify([...existing, ...events]),
		);
	}

	async compact(workflowId: string, events: WorkflowEvent[]): Promise<void> {
		localStorage.setItem(this.key(workflowId), JSON.stringify(events));
	}

	async clear(workflowId: string): Promise<void> {
		localStorage.removeItem(this.key(workflowId));
	}
}

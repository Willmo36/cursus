// ABOUTME: Pluggable storage implementations for persisting workflow event logs.
// ABOUTME: Provides in-memory storage for tests and localStorage for browser persistence.

import type { WorkflowEvent, WorkflowStorage } from "./types";

export class MemoryStorage implements WorkflowStorage {
	private store = new Map<string, WorkflowEvent[]>();
	private versions = new Map<string, number>();

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
		this.versions.delete(workflowId);
	}

	async loadVersion(workflowId: string): Promise<number | undefined> {
		return this.versions.get(workflowId);
	}

	async saveVersion(workflowId: string, version: number): Promise<void> {
		this.versions.set(workflowId, version);
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
		try {
			return JSON.parse(raw) as WorkflowEvent[];
		} catch {
			return [];
		}
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
		localStorage.removeItem(`${this.key(workflowId)}:v`);
	}

	async loadVersion(workflowId: string): Promise<number | undefined> {
		const raw = localStorage.getItem(`${this.key(workflowId)}:v`);
		if (raw === null) return undefined;
		return Number(raw);
	}

	async saveVersion(workflowId: string, version: number): Promise<void> {
		localStorage.setItem(`${this.key(workflowId)}:v`, String(version));
	}
}

export async function checkVersion(
	storage: WorkflowStorage,
	workflowId: string,
	version: number | undefined,
): Promise<boolean> {
	if (version === undefined) return false;
	if (!storage.loadVersion || !storage.saveVersion) return false;

	const stored = await storage.loadVersion(workflowId);
	if (stored === undefined) {
		await storage.saveVersion(workflowId, version);
		return false;
	}
	if (stored === version) return false;

	await storage.clear(workflowId);
	await storage.saveVersion(workflowId, version);
	return true;
}

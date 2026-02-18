// ABOUTME: Tests for workflow storage implementations.
// ABOUTME: Covers MemoryStorage and LocalStorage for persisting event logs.

import { afterEach, describe, expect, it } from "vitest";
import { LocalStorage, MemoryStorage } from "./storage";
import type { WorkflowEvent } from "./types";

const testEvents: WorkflowEvent[] = [
	{ type: "workflow_started", timestamp: 1 },
	{ type: "activity_scheduled", name: "fetch", seq: 1, timestamp: 2 },
	{ type: "activity_completed", seq: 1, result: "data", timestamp: 3 },
];

describe("MemoryStorage", () => {
	it("loads empty array for unknown workflow", async () => {
		const storage = new MemoryStorage();
		const events = await storage.load("unknown");
		expect(events).toEqual([]);
	});

	it("appends and loads events", async () => {
		const storage = new MemoryStorage();
		await storage.append("wf-1", testEvents);
		const events = await storage.load("wf-1");
		expect(events).toEqual(testEvents);
	});

	it("appends incrementally", async () => {
		const storage = new MemoryStorage();
		await storage.append("wf-1", [testEvents[0]]);
		await storage.append("wf-1", [testEvents[1], testEvents[2]]);
		const events = await storage.load("wf-1");
		expect(events).toEqual(testEvents);
	});

	it("isolates workflows by id", async () => {
		const storage = new MemoryStorage();
		await storage.append("wf-1", testEvents);
		await storage.append("wf-2", [{ type: "workflow_started", timestamp: 99 }]);

		expect(await storage.load("wf-1")).toEqual(testEvents);
		expect(await storage.load("wf-2")).toEqual([
			{ type: "workflow_started", timestamp: 99 },
		]);
	});

	it("clears events for a workflow", async () => {
		const storage = new MemoryStorage();
		await storage.append("wf-1", testEvents);
		await storage.clear("wf-1");
		const events = await storage.load("wf-1");
		expect(events).toEqual([]);
	});

	it("compact() replaces all events atomically", async () => {
		const storage = new MemoryStorage();
		await storage.append("wf-1", testEvents);

		const terminalEvent: WorkflowEvent = {
			type: "workflow_completed",
			result: "data",
			timestamp: 4,
		};
		await storage.compact("wf-1", [terminalEvent]);

		const events = await storage.load("wf-1");
		expect(events).toEqual([terminalEvent]);
	});
});

describe("LocalStorage", () => {
	const prefix = "test-wf";

	afterEach(() => {
		localStorage.clear();
	});

	it("loads empty array for unknown workflow", async () => {
		const storage = new LocalStorage(prefix);
		const events = await storage.load("unknown");
		expect(events).toEqual([]);
	});

	it("appends and loads events", async () => {
		const storage = new LocalStorage(prefix);
		await storage.append("wf-1", testEvents);
		const events = await storage.load("wf-1");
		expect(events).toEqual(testEvents);
	});

	it("appends incrementally", async () => {
		const storage = new LocalStorage(prefix);
		await storage.append("wf-1", [testEvents[0]]);
		await storage.append("wf-1", [testEvents[1], testEvents[2]]);
		const events = await storage.load("wf-1");
		expect(events).toEqual(testEvents);
	});

	it("persists to localStorage with the correct key", async () => {
		const storage = new LocalStorage(prefix);
		await storage.append("wf-1", testEvents);

		const raw = localStorage.getItem(`${prefix}:wf-1`);
		expect(raw).toBeDefined();
		expect(JSON.parse(raw as string)).toEqual(testEvents);
	});

	it("clears events for a workflow", async () => {
		const storage = new LocalStorage(prefix);
		await storage.append("wf-1", testEvents);
		await storage.clear("wf-1");

		const events = await storage.load("wf-1");
		expect(events).toEqual([]);
		expect(localStorage.getItem(`${prefix}:wf-1`)).toBeNull();
	});

	it("compact() replaces all events atomically", async () => {
		const storage = new LocalStorage(prefix);
		await storage.append("wf-1", testEvents);

		const terminalEvent: WorkflowEvent = {
			type: "workflow_completed",
			result: "data",
			timestamp: 4,
		};
		await storage.compact("wf-1", [terminalEvent]);

		const events = await storage.load("wf-1");
		expect(events).toEqual([terminalEvent]);

		const raw = localStorage.getItem(`${prefix}:wf-1`);
		expect(JSON.parse(raw as string)).toEqual([terminalEvent]);
	});

	it("returns empty array when localStorage contains corrupted data", async () => {
		const storage = new LocalStorage(prefix);
		localStorage.setItem(`${prefix}:wf-1`, "not valid json{{{");

		const events = await storage.load("wf-1");
		expect(events).toEqual([]);
	});
});

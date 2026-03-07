// ABOUTME: Tests for workflow storage implementations.
// ABOUTME: Covers MemoryStorage and LocalStorage for persisting event logs.

import { afterEach, describe, expect, it } from "vitest";
import { checkVersion, LocalStorage, MemoryStorage } from "./storage";
import type { WorkflowEvent, WorkflowStorage } from "./types";

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

	it("loadVersion returns undefined for unknown workflow", async () => {
		const storage = new MemoryStorage();
		expect(await storage.loadVersion("unknown")).toBeUndefined();
	});

	it("saveVersion + loadVersion round-trips", async () => {
		const storage = new MemoryStorage();
		await storage.saveVersion("wf-1", 3);
		expect(await storage.loadVersion("wf-1")).toBe(3);
	});

	it("clear also clears version", async () => {
		const storage = new MemoryStorage();
		await storage.saveVersion("wf-1", 2);
		await storage.append("wf-1", testEvents);
		await storage.clear("wf-1");
		expect(await storage.loadVersion("wf-1")).toBeUndefined();
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

	it("loadVersion returns undefined for unknown workflow", async () => {
		const storage = new LocalStorage(prefix);
		expect(await storage.loadVersion("unknown")).toBeUndefined();
	});

	it("saveVersion + loadVersion round-trips", async () => {
		const storage = new LocalStorage(prefix);
		await storage.saveVersion("wf-1", 5);
		expect(await storage.loadVersion("wf-1")).toBe(5);
	});

	it("clear also clears version", async () => {
		const storage = new LocalStorage(prefix);
		await storage.saveVersion("wf-1", 2);
		await storage.append("wf-1", testEvents);
		await storage.clear("wf-1");
		expect(await storage.loadVersion("wf-1")).toBeUndefined();
	});

	it("version key uses correct format (prefix:id:v)", async () => {
		const storage = new LocalStorage(prefix);
		await storage.saveVersion("wf-1", 7);
		expect(localStorage.getItem(`${prefix}:wf-1:v`)).toBe("7");
	});
});

describe("checkVersion", () => {
	it("returns false when version is undefined (no-op)", async () => {
		const storage = new MemoryStorage();
		expect(await checkVersion(storage, "wf-1", undefined)).toBe(false);
	});

	it("returns false when storage lacks version methods", async () => {
		const storage: WorkflowStorage = {
			load: async () => [],
			append: async () => {},
			compact: async () => {},
			clear: async () => {},
		};
		expect(await checkVersion(storage, "wf-1", 1)).toBe(false);
	});

	it("saves version on first run (no stored version)", async () => {
		const storage = new MemoryStorage();
		const wiped = await checkVersion(storage, "wf-1", 1);
		expect(wiped).toBe(false);
		expect(await storage.loadVersion("wf-1")).toBe(1);
	});

	it("returns false when versions match", async () => {
		const storage = new MemoryStorage();
		await storage.saveVersion("wf-1", 2);
		expect(await checkVersion(storage, "wf-1", 2)).toBe(false);
	});

	it("clears storage and returns true on mismatch", async () => {
		const storage = new MemoryStorage();
		await storage.append("wf-1", testEvents);
		await storage.saveVersion("wf-1", 1);

		const wiped = await checkVersion(storage, "wf-1", 2);
		expect(wiped).toBe(true);
		expect(await storage.load("wf-1")).toEqual([]);
	});

	it("saves new version after mismatch wipe", async () => {
		const storage = new MemoryStorage();
		await storage.saveVersion("wf-1", 1);

		await checkVersion(storage, "wf-1", 2);
		expect(await storage.loadVersion("wf-1")).toBe(2);
	});
});

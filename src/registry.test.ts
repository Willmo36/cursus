// ABOUTME: Tests for the WorkflowRegistry that manages shared workflow instances.
// ABOUTME: Covers start, receive, signal, persistence, and failure handling.

import { describe, expect, it, vi } from "vitest";
import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import { WorkflowRegistry } from "./registry";
import { MemoryStorage } from "./storage";
import { activity, all, handler, join, publish, published, race, receive, sleep, subscribe, workflow } from "./types";
import type {
	WorkflowEvent,
	WorkflowEventObserver,
} from "./types";
import { EVENT_SCHEMA_VERSION, LIBRARY_VERSION } from "./version";

describe("WorkflowRegistry", () => {
	it("start() runs a registered workflow to completion", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);
		await registry.start("greet");

		const state = registry.getState("greet");
		expect(state?.status).toBe("completed");
	});

	it("waitFor() returns the result of a completed workflow", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);
		await registry.start("greet");

		const result = await registry.waitFor<string>("greet");
		expect(result).toBe("hello");
	});

	it("waitFor() auto-starts an unstarted workflow (start: true)", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);

		const result = await registry.waitFor<string>("greet", { start: true });
		expect(result).toBe("hello");
	});

	it("waitFor() with start: false waits until started by something else", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);

		let resolved = false;
		const waitPromise = registry
			.waitFor<string>("greet", { start: false })
			.then((r) => {
				resolved = true;
				return r;
			});

		// Should not have resolved yet
		await new Promise((r) => setTimeout(r, 10));
		expect(resolved).toBe(false);

		// Now start it
		await registry.start("greet");

		const result = await waitPromise;
		expect(result).toBe("hello");
		expect(resolved).toBe(true);
	});

	it("multiple waiters on same workflow all get the result", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);

		// Two waiters before starting
		const wait1 = registry.waitFor<string>("greet", { start: false });
		const wait2 = registry.waitFor<string>("greet", { start: false });

		await registry.start("greet");

		const [r1, r2] = await Promise.all([wait1, wait2]);
		expect(r1).toBe("hello");
		expect(r2).toBe("hello");
	});

	it("waitFor() on already-completed workflow returns immediately", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);
		await registry.start("greet");

		// Should resolve immediately
		const result = await registry.waitFor<string>("greet");
		expect(result).toBe("hello");
	});

	it("waitFor() on unregistered ID throws", async () => {
		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({}, storage);

		await expect(registry.waitFor("nonexistent")).rejects.toThrow(
			/not registered/,
		);
	});

	it("start() on unregistered ID throws", async () => {
		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({}, storage);

		await expect(registry.start("nonexistent")).rejects.toThrow(
			/not registered/,
		);
	});

	it("persists events to storage", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);
		await registry.start("greet");

		const events = await storage.load("greet");
		expect(events.length).toBeGreaterThan(0);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "workflow_completed", result: "hello" }),
		);
	});

	it("compacts storage after workflow completes", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);
		await registry.start("greet");

		const events = await storage.load("greet");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "workflow_completed",
			result: "hello",
		});
	});

	it("compacts storage after workflow fails", async () => {
		const wf = workflow(function* () {
			return yield* activity("fail", async () => {
				throw new Error("boom");
			});
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ fail: wf }, storage);
		await registry.start("fail");

		const events = await storage.load("fail");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "workflow_failed",
			error: "boom",
		});
	});

	it("failed workflow rejects waiters", async () => {
		const wf = workflow(function* () {
			return yield* activity("fail", async () => {
				throw new Error("boom");
			});
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ fail: wf }, storage);

		const waitPromise = registry.waitFor<string>("fail");
		await expect(waitPromise).rejects.toThrow("boom");
	});

	it("start() is idempotent — second call is a no-op", async () => {
		let callCount = 0;
		const wf = workflow(function* () {
			callCount++;
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);

		await registry.start("greet");
		await registry.start("greet");

		expect(callCount).toBe(1);
	});

	it("signal() delegates to the interpreter", async () => {
		const wf = workflow(function* () {
			const data = yield* receive<string>("submit");
			return `got: ${data}`;
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ form: wf }, storage);

		const startPromise = registry.start("form");

		// Wait for the workflow to enter waiting state
		await new Promise((r) => setTimeout(r, 10));

		registry.signal("form", "submit", "form-data");

		await startPromise;

		const result = await registry.waitFor<string>("form");
		expect(result).toBe("got: form-data");
	});

	it("onStateChange notifies subscribers", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);

		const statuses: string[] = [];
		registry.onStateChange("greet", () => {
			const s = registry.getState("greet");
			if (s) statuses.push(s.status);
		});

		await registry.start("greet");

		expect(statuses).toContain("completed");
	});

	describe("observe/unobserve", () => {
		it("observe() makes a local interpreter's events visible via getEvents()", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			await interpreter.run();

			registry.observe("local", interpreter);

			const events = registry.getEvents("local");
			expect(events[0]).toMatchObject({ type: "workflow_started" });
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_completed",
					result: "hello",
				}),
			);
		});

		it("observe() makes the ID visible via getWorkflowIds()", () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ global: wf }, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);

			registry.observe("local", interpreter);

			const ids = registry.getWorkflowIds();
			expect(ids).toContain("global");
			expect(ids).toContain("local");
		});

		it("observe() does not override an existing global workflow", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ greet: wf }, storage);
			await registry.start("greet");

			const log = new EventLog();
			const fakeInterpreter = new Interpreter(wf, log);

			registry.observe("greet", fakeInterpreter);

			// Should still return the global workflow's events, not the fake one
			const events = registry.getEvents("greet");
			expect(events[0]).toMatchObject({ type: "workflow_started" });
		});

		it("unobserve() removes the entry", () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);

			registry.observe("local", interpreter);
			expect(registry.getWorkflowIds()).toContain("local");

			registry.unobserve("local");
			expect(registry.getWorkflowIds()).not.toContain("local");
		});

		it("re-observe() replaces interpreter for previously observed entries", async () => {
			const wf = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log1 = new EventLog();
			const interpreter1 = new Interpreter(wf, log1);
			interpreter1.run();

			registry.observe("local", interpreter1);

			const log2 = new EventLog();
			const interpreter2 = new Interpreter(wf, log2);
			interpreter2.run();

			registry.observe("local", interpreter2);

			// Should now point to interpreter2
			expect(registry.getInterpreter("local")).toBe(interpreter2);

			// State changes from interpreter2 should fire listeners
			const calls: string[] = [];
			registry.onStateChange("local", () => calls.push("changed"));

			await vi.waitFor(() => {
				expect(interpreter2.status).toBe("waiting");
			});

			interpreter2.signal("submit", "data");
			expect(calls.length).toBeGreaterThan(0);
		});

		it("observe() wires interpreter state changes to entry listeners", async () => {
			const wf = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			registry.observe("local", interpreter);

			const calls: string[] = [];
			registry.onStateChange("local", () => calls.push("changed"));

			interpreter.signal("submit", "data");
			await runPromise;

			expect(calls.length).toBeGreaterThan(0);
		});
	});

	describe("onWorkflowsChange", () => {
		it("fires when observe is called", () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const calls: string[] = [];
			registry.onWorkflowsChange(() => calls.push("changed"));

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			registry.observe("local", interpreter);

			expect(calls).toEqual(["changed"]);
		});

		it("fires when unobserve is called", () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			registry.observe("local", interpreter);

			const calls: string[] = [];
			registry.onWorkflowsChange(() => calls.push("changed"));

			registry.unobserve("local");

			expect(calls).toEqual(["changed"]);
		});

		it("returns an unsubscribe function", () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const calls: string[] = [];
			const unsub = registry.onWorkflowsChange(() => calls.push("changed"));

			unsub();

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			registry.observe("local", interpreter);

			expect(calls).toEqual([]);
		});
	});

	it("getWorkflowIds() returns all registered workflow IDs", () => {
		const wfA = workflow(function* () {
			return yield* activity("a", async () => "a");
		});
		const wfB = workflow(function* () {
			return yield* activity("b", async () => "b");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry(
			{ alpha: wfA, beta: wfB },
			storage,
		);

		const ids = registry.getWorkflowIds();
		expect(ids).toContain("alpha");
		expect(ids).toContain("beta");
		expect(ids).toHaveLength(2);
	});

	it("getEvents() returns events for a started workflow", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);
		await registry.start("greet");

		const events = registry.getEvents("greet");
		expect(events[0]).toMatchObject({ type: "workflow_started" });
		expect(events).toContainEqual(
			expect.objectContaining({ type: "workflow_completed", result: "hello" }),
		);
	});

	describe("reset", () => {
		it("reset() cancels, clears storage, and allows restart", async () => {
			let runCount = 0;
			const wf = workflow(function* () {
				runCount++;
				return yield* activity("count", async () => runCount);
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ counter: wf }, storage);

			await registry.start("counter");
			expect(registry.getState("counter")?.status).toBe("completed");
			expect(await registry.waitFor("counter")).toBe(1);

			await registry.reset("counter");

			// Entry should be reset — no interpreter, not completed
			expect(registry.getState("counter")).toBeUndefined();

			// Storage should be cleared
			const events = await storage.load("counter");
			expect(events).toEqual([]);

			// Can start again
			await registry.start("counter");
			expect(registry.getState("counter")?.status).toBe("completed");
			expect(await registry.waitFor("counter")).toBe(2);
		});

		it("reset() cancels a waiting workflow", async () => {
			const wf = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ form: wf }, storage);

			const startPromise = registry.start("form");
			await new Promise((r) => setTimeout(r, 10));

			expect(registry.getState("form")?.status).toBe("waiting");

			await registry.reset("form");
			await startPromise;

			// Should be reset, not waiting
			expect(registry.getState("form")).toBeUndefined();
		});

		it("reset() notifies state change listeners", async () => {
			const wf = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ form: wf }, storage);

			const startPromise = registry.start("form");
			await new Promise((r) => setTimeout(r, 10));

			const calls: string[] = [];
			registry.onStateChange("form", () => calls.push("changed"));

			await registry.reset("form");
			await startPromise;

			expect(calls.length).toBeGreaterThan(0);
		});

		it("reset() on unregistered ID throws", async () => {
			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			await expect(registry.reset("nonexistent")).rejects.toThrow(
				/not registered/,
			);
		});
	});

	it("getEvents() returns empty array for an unstarted workflow", () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: wf }, storage);

		const events = registry.getEvents("greet");
		expect(events).toEqual([]);
	});

	describe("circular dependency detection", () => {
		it("detects a direct cycle (A → B → A)", async () => {
			const wfA = workflow(function* () {
				return yield* join("B");
			});

			const wfB = workflow(function* () {
				return yield* join("A");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ A: wfA, B: wfB },
				storage,
			);

			await registry.start("A");

			expect(registry.getState("A")?.status).toBe("failed");
			const interpreter = registry.getInterpreter("A");
			expect(interpreter?.error).toMatch(/Circular dependency/);
			expect(interpreter?.error).toContain("A");
			expect(interpreter?.error).toContain("B");
		});

		it("detects a transitive cycle (A → B → C → A)", async () => {
			const wfA = workflow(function* () {
				return yield* join("B");
			});

			const wfB = workflow(function* () {
				return yield* join("C");
			});

			const wfC = workflow(function* () {
				return yield* join("A");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ A: wfA, B: wfB, C: wfC },
				storage,
			);

			await registry.start("A");

			expect(registry.getState("A")?.status).toBe("failed");
			const interpreter = registry.getInterpreter("A");
			expect(interpreter?.error).toMatch(/Circular dependency/);
			expect(interpreter?.error).toContain("A");
			expect(interpreter?.error).toContain("B");
			expect(interpreter?.error).toContain("C");
		});

		it("does not false-positive when two workflows depend on the same target", async () => {
			const wfTarget = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const wfA = workflow(function* () {
				return yield* join("target");
			});

			const wfC = workflow(function* () {
				return yield* join("target");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ target: wfTarget, A: wfA, C: wfC },
				storage,
			);

			await registry.start("A");
			await registry.start("C");

			expect(registry.getState("A")?.status).toBe("completed");
			expect(registry.getState("C")?.status).toBe("completed");
			expect(await registry.waitFor("A")).toBe("hello");
			expect(await registry.waitFor("C")).toBe("hello");
		});

		it("detects a cycle through all() with workflow refs", async () => {
			const wfA = workflow(function* () {
				const [result] = yield* all(join("B"));
				return result;
			});

			const wfB = workflow(function* () {
				return yield* join("A");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ A: wfA, B: wfB },
				storage,
			);

			await registry.start("A");

			expect(registry.getState("A")?.status).toBe("failed");
			const interpreter = registry.getInterpreter("A");
			expect(interpreter?.error).toMatch(/Circular dependency/);
		});

		it("cleans up dependency edges after workflow completes", async () => {
			const wfA = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const wfB = workflow(function* () {
				return yield* join("A");
			});

			const wfC = workflow(function* () {
				return yield* join("B");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ A: wfA, B: wfB, C: wfC },
				storage,
			);

			// B depends on A; after both complete, starting C (which depends on B) should work
			await registry.start("B");
			expect(registry.getState("B")?.status).toBe("completed");

			await registry.start("C");
			expect(registry.getState("C")?.status).toBe("completed");
			expect(await registry.waitFor("C")).toBe("hello");
		});
	});

	describe("event observers", () => {
		it("observers are called when workflows run", async () => {
			const observed: Array<{ workflowId: string; event: WorkflowEvent }> = [];
			const observer: WorkflowEventObserver = (wid, event) =>
				observed.push({ workflowId: wid, event });

			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ greet: wf }, storage, [
				observer,
			]);
			await registry.start("greet");

			const types = observed
				.filter((o) => o.workflowId === "greet")
				.map((o) => o.event.type);
			expect(types).toContain("workflow_started");
			expect(types).toContain("activity_scheduled");
			expect(types).toContain("activity_completed");
			expect(types).toContain("workflow_completed");
		});
	});

	describe("versioning", () => {
		it("versioned workflow starts fresh normally", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ greet: wf },
				storage,
				undefined,
				{ greet: 1 },
			);
			await registry.start("greet");

			expect(registry.getState("greet")?.status).toBe("completed");
			expect(await registry.waitFor("greet")).toBe("hello");
		});

		it("versioned workflow with same version replays from storage", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const wf = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const storage = new MemoryStorage();

			// First run — stores events + version
			const registry1 = new WorkflowRegistry(
				{ greet: wf },
				storage,
				undefined,
				{ greet: 1 },
			);
			await registry1.start("greet");
			expect(activityFn).toHaveBeenCalledTimes(1);

			// Second run — same version, should replay without re-running activity
			const registry2 = new WorkflowRegistry(
				{ greet: wf },
				storage,
				undefined,
				{ greet: 1 },
			);
			await registry2.start("greet");
			expect(activityFn).toHaveBeenCalledTimes(1);
			expect(await registry2.waitFor("greet")).toBe("hello");
		});

		it("versioned workflow with different version wipes and restarts", async () => {
			let callCount = 0;
			const wf = workflow(function* () {
				callCount++;
				return yield* activity("count", async () => callCount);
			});

			const storage = new MemoryStorage();

			// First run with version 1
			const registry1 = new WorkflowRegistry(
				{ counter: wf },
				storage,
				undefined,
				{ counter: 1 },
			);
			await registry1.start("counter");
			expect(await registry1.waitFor("counter")).toBe(1);

			// Second run with version 2 — should wipe and restart
			const registry2 = new WorkflowRegistry(
				{ counter: wf },
				storage,
				undefined,
				{ counter: 2 },
			);
			await registry2.start("counter");
			expect(await registry2.waitFor("counter")).toBe(2);
		});

		it("versioned workflow after compaction with different version wipes and restarts", async () => {
			let callCount = 0;
			const wf = workflow(function* () {
				callCount++;
				return yield* activity("count", async () => callCount);
			});

			const storage = new MemoryStorage();

			// First run — compacts to terminal event
			const registry1 = new WorkflowRegistry(
				{ counter: wf },
				storage,
				undefined,
				{ counter: 1 },
			);
			await registry1.start("counter");

			// Confirm it compacted
			const events = await storage.load("counter");
			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("workflow_completed");

			// Second run with different version — should wipe compacted data
			const registry2 = new WorkflowRegistry(
				{ counter: wf },
				storage,
				undefined,
				{ counter: 2 },
			);
			await registry2.start("counter");
			expect(await registry2.waitFor("counter")).toBe(2);
		});

		it("unversioned workflow ignores version check", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			await storage.saveVersion("greet", 99);
			await storage.append("greet", [
				{
					type: "workflow_completed",
					result: "old-result",
					timestamp: 1,
				},
			]);

			// No versions passed — should replay from storage
			const registry = new WorkflowRegistry({ greet: wf }, storage);
			await registry.start("greet");
			expect(await registry.waitFor("greet")).toBe("old-result");
		});
	});

	it("onStateChange returns unsubscribe function", async () => {
		const wf = workflow(function* () {
			const data = yield* receive<string>("submit");
			return `got: ${data}`;
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ form: wf }, storage);

		const statuses: string[] = [];
		const unsubscribe = registry.onStateChange("form", () => {
			const s = registry.getState("form");
			if (s) statuses.push(s.status);
		});

		const startPromise = registry.start("form");

		// Wait for waiting state
		await new Promise((r) => setTimeout(r, 10));

		// Unsubscribe before signal
		unsubscribe();

		registry.signal("form", "submit", "data");
		await startPromise;

		// Should NOT have received the completed notification
		expect(statuses).not.toContain("completed");
	});

	describe("publish", () => {
		it("publish() resolves existing waiters", async () => {
			const wf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				// Keep running — don't return yet
				yield* receive("login");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ session: wf }, storage);

			// Start session workflow (it will wait for login)
			const startPromise = registry.start("session");

			await new Promise((r) => setTimeout(r, 10));

			// Add a waiter before publishing
			let waiterResult: unknown;
			const waiterPromise = registry
				.waitFor("session", { start: false })
				.then((r) => {
					waiterResult = r;
				});

			await new Promise((r) => setTimeout(r, 10));

			// Send login signal to trigger publish
			registry.signal("session", "login", { user: "max" });

			await new Promise((r) => setTimeout(r, 10));

			expect(waiterResult).toEqual({ user: "max" });
		});

		it("waitFor returns published value immediately after publish", async () => {
			const wf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				yield* receive("login");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ session: wf }, storage);
			const startPromise = registry.start("session");

			await new Promise((r) => setTimeout(r, 10));

			// Send login — triggers publish
			registry.signal("session", "login", { user: "max" });
			await new Promise((r) => setTimeout(r, 10));

			// After publish, new waitFor should resolve immediately
			const result = await registry.waitFor("session", { start: false });
			expect(result).toEqual({ user: "max" });
		});

		it("waitFor returns completed value for non-publishing workflows", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ greet: wf }, storage);
			await registry.start("greet");

			const result = await registry.waitFor<string>("greet");
			expect(result).toBe("hello");
		});

		it("integration: published() gets published value from another workflow", async () => {
			const sessionWf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				yield* receive("login");
			});

			const checkoutWf = workflow(function* () {
				const account = yield* published<{ user: string }>("session");
				return `checkout for ${account.user}`;
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ session: sessionWf, checkout: checkoutWf },
				storage,
			);

			// Start session
			const sessionPromise = registry.start("session");
			await new Promise((r) => setTimeout(r, 10));

			// Login
			registry.signal("session", "login", { user: "max" });
			await new Promise((r) => setTimeout(r, 10));

			// Start checkout — should get published value immediately
			const checkoutPromise = registry.start("checkout");
			await new Promise((r) => setTimeout(r, 10));

			const result = await registry.waitFor<string>("checkout");
			expect(result).toBe("checkout for max");
		});

		it("reset clears published state", async () => {
			const wf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				yield* receive("login");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ session: wf }, storage);
			const startPromise = registry.start("session");

			await new Promise((r) => setTimeout(r, 10));
			registry.signal("session", "login", { user: "max" });
			await new Promise((r) => setTimeout(r, 10));

			// Published — waitFor should resolve immediately
			const r1 = await registry.waitFor("session", { start: false });
			expect(r1).toEqual({ user: "max" });

			// Reset
			await registry.reset("session");

			// After reset, waitFor should not resolve immediately
			let resolved = false;
			registry.waitFor("session", { start: false }).then(() => {
				resolved = true;
			});
			await new Promise((r) => setTimeout(r, 20));
			expect(resolved).toBe(false);
		});

		it("compaction preserves workflow_published event alongside terminal event", async () => {
			const wf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				return `done for ${user}`;
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ session: wf }, storage);
			const startPromise = registry.start("session");

			await new Promise((r) => setTimeout(r, 10));
			registry.signal("session", "login", { user: "max" });
			await startPromise;

			// After compaction, storage should have both published and terminal events
			const events = await storage.load("session");
			expect(events).toHaveLength(2);
			expect(events[0]).toMatchObject({
				type: "workflow_published",
				value: { user: "max" },
			});
			expect(events[1]).toMatchObject({
				type: "workflow_completed",
				result: "done for max",
			});
		});

		it("reload from compacted storage restores published state for waitFor", async () => {
			const wf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				return `done for ${user}`;
			});

			const storage = new MemoryStorage();
			const registry1 = new WorkflowRegistry({ session: wf }, storage);
			const startPromise = registry1.start("session");

			await new Promise((r) => setTimeout(r, 10));
			registry1.signal("session", "login", { user: "max" });
			await startPromise;

			// Create a fresh registry loading from the same (compacted) storage
			const registry2 = new WorkflowRegistry({ session: wf }, storage);
			const result = await registry2.waitFor<{ user: string }>("session");

			// waitFor should return the published value, not the completed value
			expect(result).toEqual({ user: "max" });
		});
	});

	describe("waitForPublished / waitForCompletion", () => {
		it("waitForPublished() returns published value", async () => {
			const wf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				yield* receive("login");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ session: wf }, storage);
			const startPromise = registry.start("session");

			await new Promise((r) => setTimeout(r, 10));

			// Add a published waiter before publishing
			let waiterResult: unknown;
			const waiterPromise = registry
				.waitForPublished("session", { start: false })
				.then((r) => {
					waiterResult = r;
				});

			await new Promise((r) => setTimeout(r, 10));

			registry.signal("session", "login", { user: "max" });
			await new Promise((r) => setTimeout(r, 10));

			expect(waiterResult).toEqual({ user: "max" });
		});

		it("waitForCompletion() returns result value, not published value", async () => {
			const wf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				return `done for ${user}`;
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ session: wf }, storage);
			const startPromise = registry.start("session");

			await new Promise((r) => setTimeout(r, 10));

			// Add a completion waiter
			const completionPromise = registry.waitForCompletion<string>("session", {
				start: false,
			});

			await new Promise((r) => setTimeout(r, 10));

			registry.signal("session", "login", { user: "max" });
			await startPromise;

			const result = await completionPromise;
			expect(result).toBe("done for max");
		});

		it("publish resolves only publishedWaiters, not completionWaiters", async () => {
			const wf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				// Keep running
				yield* receive("login");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ session: wf }, storage);
			const startPromise = registry.start("session");

			await new Promise((r) => setTimeout(r, 10));

			let publishedResolved = false;
			let completionResolved = false;

			registry.waitForPublished("session", { start: false }).then(() => {
				publishedResolved = true;
			});
			registry.waitForCompletion("session", { start: false }).then(() => {
				completionResolved = true;
			});

			await new Promise((r) => setTimeout(r, 10));

			registry.signal("session", "login", { user: "max" });
			await new Promise((r) => setTimeout(r, 10));

			expect(publishedResolved).toBe(true);
			expect(completionResolved).toBe(false);
		});

		it("completion resolves completionWaiters with result", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ greet: wf }, storage);

			const completionPromise = registry.waitForCompletion<string>("greet");
			const result = await completionPromise;
			expect(result).toBe("hello");
		});

		it("failure rejects both published and completion waiters", async () => {
			const wf = workflow(function* () {
				return yield* activity("fail", async () => {
					throw new Error("boom");
				});
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ fail: wf }, storage);

			const publishedPromise = registry.waitForPublished("fail");
			const completionPromise = registry.waitForCompletion("fail");

			await expect(publishedPromise).rejects.toThrow("boom");
			await expect(completionPromise).rejects.toThrow("boom");
		});

		it("waitForPublished returns immediately when already published", async () => {
			const wf = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				yield* receive("login");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ session: wf }, storage);
			const startPromise = registry.start("session");

			await new Promise((r) => setTimeout(r, 10));
			registry.signal("session", "login", { user: "max" });
			await new Promise((r) => setTimeout(r, 10));

			const result = await registry.waitForPublished("session", {
				start: false,
			});
			expect(result).toEqual({ user: "max" });
		});

		it("waitForCompletion returns immediately when already completed", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ greet: wf }, storage);
			await registry.start("greet");

			const result = await registry.waitForCompletion<string>("greet");
			expect(result).toBe("hello");
		});
	});

	describe("published where predicate", () => {
		it("waitForPublished skips value that does not match where", async () => {
			type UserState = { status: "loading" } | { status: "ready"; user: string };

			const wf = workflow(function* () {
				yield* publish({ status: "loading" });
				yield* receive("go");
				yield* publish({ status: "ready", user: "max" });
				yield* receive("go");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ user: wf }, storage);
			const startPromise = registry.start("user");

			await new Promise((r) => setTimeout(r, 10));

			// At this point, user has published { status: "loading" }
			// waitForPublished with where should NOT resolve yet
			let resolved = false;
			let resolvedValue: unknown;
			registry
				.waitForPublished<UserState>("user", {
					start: false,
					where: (v) => (v as UserState).status === "ready",
				})
				.then((r) => {
					resolved = true;
					resolvedValue = r;
				});

			await new Promise((r) => setTimeout(r, 10));
			expect(resolved).toBe(false);

			// Trigger second publish with ready state
			registry.signal("user", "go", undefined);
			await new Promise((r) => setTimeout(r, 10));

			expect(resolved).toBe(true);
			expect(resolvedValue).toEqual({ status: "ready", user: "max" });
		});

		it("waitForPublished resolves immediately when where matches current value", async () => {
			const wf = workflow(function* () {
				yield* publish("hello");
				yield* receive("go");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ dep: wf }, storage);
			const startPromise = registry.start("dep");
			await new Promise((r) => setTimeout(r, 10));

			const result = await registry.waitForPublished<string>("dep", {
				start: false,
				where: (v) => v === "hello",
			});
			expect(result).toBe("hello");
		});

		it("publish re-evaluates where waiters on each publish", async () => {
			type State = { count: number };

			const wf = workflow(function* () {
				let count = 0;
				yield* publish({ count });
				yield* handler()
					.on("inc", function* () {
						count++;
						yield* publish({ count });
					})
					.as<void>();
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ counter: wf }, storage);
			const startPromise = registry.start("counter");
			await new Promise((r) => setTimeout(r, 10));

			// Wait for count >= 3
			let resolvedValue: unknown;
			registry
				.waitForPublished<State>("counter", {
					start: false,
					where: (v) => (v as State).count >= 3,
				})
				.then((r) => {
					resolvedValue = r;
				});

			await new Promise((r) => setTimeout(r, 10));
			expect(resolvedValue).toBeUndefined();

			// Increment 1, 2, 3
			registry.signal("counter", "inc", undefined);
			await new Promise((r) => setTimeout(r, 10));
			expect(resolvedValue).toBeUndefined();

			registry.signal("counter", "inc", undefined);
			await new Promise((r) => setTimeout(r, 10));
			expect(resolvedValue).toBeUndefined();

			registry.signal("counter", "inc", undefined);
			await new Promise((r) => setTimeout(r, 10));
			expect(resolvedValue).toEqual({ count: 3 });
		});
	});

	describe("ctx.subscribe()", () => {
		it("runs callback each time dependency publishes a new value", async () => {
			const fetchCalls: number[] = [];

			const accountWf = workflow(function* () {
				yield* publish({ name: "max" });
				yield* handler()
					.on("update", function* (payload: { name: string }) {
						yield* publish(payload);
					})
					.as<void>();
			});

			const pointsWf = workflow(function* () {
				let callCount = 0;
				yield* subscribe("account", {}, function* (account) {
					callCount++;
					fetchCalls.push(callCount);
					const points = yield* activity(
						"fetchPoints",
						async () => callCount * 100,
					);
					yield* publish(points);
				});
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ account: accountWf, points: pointsWf },
				storage,
			);

			// Start both
			const accountPromise = registry.start("account");
			await new Promise((r) => setTimeout(r, 10));
			const pointsPromise = registry.start("points");
			await new Promise((r) => setTimeout(r, 10));

			// Points should have fetched once for initial publish
			expect(fetchCalls).toEqual([1]);

			// Update account — should trigger points to refetch
			registry.signal("account", "update", { name: "max2" });
			await new Promise((r) => setTimeout(r, 50));

			expect(fetchCalls).toEqual([1, 2]);
		});

		it("runs body to completion before waiting for next publish", async () => {
			const bodyCalls: number[] = [];

			const sourceWf = workflow(function* () {
				yield* publish(1);
				yield* handler()
					.on("bump", function* () {
						yield* publish(2);
					})
					.as<void>();
			});

			const reactiveWf = workflow(function* () {
				yield* subscribe("source", {}, function* (value) {
					const result = yield* activity(
						"fetch",
						async () => `result-${value}`,
					);
					bodyCalls.push(value as number);
					yield* publish(result);
				});
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ source: sourceWf, reactive: reactiveWf },
				storage,
			);

			registry.start("source");
			await new Promise((r) => setTimeout(r, 10));
			registry.start("reactive");
			await new Promise((r) => setTimeout(r, 50));

			// First body completed with value 1
			expect(bodyCalls).toEqual([1]);

			// Bump to value 2 — should trigger second body
			registry.signal("source", "bump", undefined);
			await new Promise((r) => setTimeout(r, 50));

			expect(bodyCalls).toEqual([1, 2]);
		});

		it("subscribe with where filters values", async () => {
			type UserState = { status: "loading" } | { status: "ready"; user: string };
			const receivedUsers: string[] = [];

			const userWf = workflow(function* () {
				yield* publish({ status: "loading" as const });
				yield* receive("go");
				yield* publish({ status: "ready" as const, user: "max" });
				yield* receive("go");
			});

			const consumerWf = workflow(function* () {
				yield* subscribe(
					"user",
					{
						where: (s): s is { status: "ready"; user: string } =>
							(s as { status: string }).status === "ready",
					},
					function* (state) {
						receivedUsers.push((state as { status: "ready"; user: string }).user);
					},
				);
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ user: userWf, consumer: consumerWf },
				storage,
			);

			registry.start("user");
			await new Promise((r) => setTimeout(r, 10));
			registry.start("consumer");
			await new Promise((r) => setTimeout(r, 10));

			// Loading state should be filtered out
			expect(receivedUsers).toEqual([]);

			// Trigger ready state
			registry.signal("user", "go", undefined);
			await new Promise((r) => setTimeout(r, 50));

			expect(receivedUsers).toEqual(["max"]);
		});

		it("done() exits the subscribe loop and returns a value", async () => {
			const sourceWf = workflow(function* () {
				yield* publish(1);
				yield* handler()
					.on("bump", function* () {
						yield* publish(2);
					})
					.as<void>();
			});

			const consumerWf = workflow(function* () {
				const result = yield* subscribe(
					"source",
					{},
					function* (value, done) {
						if (value === 2) {
							yield* done("stopped at 2");
						}
					},
				);
				return `result: ${result}`;
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ source: sourceWf, consumer: consumerWf },
				storage,
			);

			registry.start("source");
			await new Promise((r) => setTimeout(r, 10));
			const consumerPromise = registry.start("consumer");
			await new Promise((r) => setTimeout(r, 10));

			// First publish (value=1) — body runs but doesn't call done
			// Bump to value=2 — body calls done("stopped at 2")
			registry.signal("source", "bump", undefined);
			await consumerPromise;

			const result = await registry.waitForCompletion<string>("consumer");
			expect(result).toBe("result: stopped at 2");
		});
	});

	describe("getTrace", () => {
		it("returns correct envelope shape", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ greet: wf }, storage);
			await registry.start("greet");

			const trace = registry.getTrace("greet");
			expect(trace.schemaVersion).toBe(EVENT_SCHEMA_VERSION);
			expect(trace.libraryVersion).toBe(LIBRARY_VERSION);
			expect(trace.workflowId).toBe("greet");
			expect(Array.isArray(trace.events)).toBe(true);
		});

		it("includes all events from the workflow", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ greet: wf }, storage);
			await registry.start("greet");

			const trace = registry.getTrace("greet");
			expect(trace.events).toEqual(registry.getEvents("greet"));
			expect(trace.events.length).toBeGreaterThan(0);
		});

		it("returns empty events array for un-started workflow", () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ greet: wf }, storage);

			const trace = registry.getTrace("greet");
			expect(trace.events).toEqual([]);
			expect(trace.workflowId).toBe("greet");
		});
	});
});

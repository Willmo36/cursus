// ABOUTME: Tests for the WorkflowRegistry that manages shared workflow instances.
// ABOUTME: Covers start, waitFor, signal, persistence, and failure handling.

import { describe, expect, it, vi } from "vitest";
import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import { WorkflowRegistry } from "./registry";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";

describe("WorkflowRegistry", () => {
	it("start() runs a registered workflow to completion", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);
		await registry.start("greet");

		const state = registry.getState("greet");
		expect(state).toBe("completed");
	});

	it("waitFor() returns the result of a completed workflow", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);
		await registry.start("greet");

		const result = await registry.waitFor<string>("greet");
		expect(result).toBe("hello");
	});

	it("waitFor() auto-starts an unstarted workflow (start: true)", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);

		const result = await registry.waitFor<string>("greet", { start: true });
		expect(result).toBe("hello");
	});

	it("waitFor() with start: false waits until started by something else", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);

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
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);

		// Two waiters before starting
		const wait1 = registry.waitFor<string>("greet", { start: false });
		const wait2 = registry.waitFor<string>("greet", { start: false });

		await registry.start("greet");

		const [r1, r2] = await Promise.all([wait1, wait2]);
		expect(r1).toBe("hello");
		expect(r2).toBe("hello");
	});

	it("waitFor() on already-completed workflow returns immediately", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);
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
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);
		await registry.start("greet");

		const events = await storage.load("greet");
		expect(events.length).toBeGreaterThan(0);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "workflow_completed", result: "hello" }),
		);
	});

	it("failed workflow rejects waiters", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("fail", async () => {
				throw new Error("boom");
			});
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ fail: workflow }, storage);

		const waitPromise = registry.waitFor<string>("fail");
		await expect(waitPromise).rejects.toThrow("boom");
	});

	it("start() is idempotent — second call is a no-op", async () => {
		let callCount = 0;
		const workflow: WorkflowFunction<string> = function* (ctx) {
			callCount++;
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);

		await registry.start("greet");
		await registry.start("greet");

		expect(callCount).toBe(1);
	});

	it("signal() delegates to the interpreter", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const data = yield* ctx.waitFor<string>("submit");
			return `got: ${data}`;
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ form: workflow }, storage);

		const startPromise = registry.start("form");

		// Wait for the workflow to enter waiting state
		await new Promise((r) => setTimeout(r, 10));

		registry.signal("form", "submit", "form-data");

		await startPromise;

		const result = await registry.waitFor<string>("form");
		expect(result).toBe("got: form-data");
	});

	it("onStateChange notifies subscribers", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);

		const states: string[] = [];
		registry.onStateChange("greet", () => {
			const s = registry.getState("greet");
			if (s) states.push(s);
		});

		await registry.start("greet");

		expect(states).toContain("completed");
	});

	describe("observe/unobserve", () => {
		it("observe() makes a local interpreter's events visible via getEvents()", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
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
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ global: workflow }, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);

			registry.observe("local", interpreter);

			const ids = registry.getWorkflowIds();
			expect(ids).toContain("global");
			expect(ids).toContain("local");
		});

		it("observe() does not override an existing global workflow", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ greet: workflow }, storage);
			await registry.start("greet");

			const log = new EventLog();
			const fakeInterpreter = new Interpreter(workflow, log);

			registry.observe("greet", fakeInterpreter);

			// Should still return the global workflow's events, not the fake one
			const events = registry.getEvents("greet");
			expect(events[0]).toMatchObject({ type: "workflow_started" });
		});

		it("unobserve() removes the entry", () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);

			registry.observe("local", interpreter);
			expect(registry.getWorkflowIds()).toContain("local");

			registry.unobserve("local");
			expect(registry.getWorkflowIds()).not.toContain("local");
		});

		it("re-observe() replaces interpreter for previously observed entries", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log1 = new EventLog();
			const interpreter1 = new Interpreter(workflow, log1);
			interpreter1.run();

			registry.observe("local", interpreter1);

			const log2 = new EventLog();
			const interpreter2 = new Interpreter(workflow, log2);
			interpreter2.run();

			registry.observe("local", interpreter2);

			// Should now point to interpreter2
			expect(registry.getInterpreter("local")).toBe(interpreter2);

			// State changes from interpreter2 should fire listeners
			const calls: string[] = [];
			registry.onStateChange("local", () => calls.push("changed"));

			await vi.waitFor(() => {
				expect(interpreter2.state).toBe("waiting");
			});

			interpreter2.signal("submit", "data");
			expect(calls.length).toBeGreaterThan(0);
		});

		it("observe() wires interpreter state changes to entry listeners", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
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
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const calls: string[] = [];
			registry.onWorkflowsChange(() => calls.push("changed"));

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			registry.observe("local", interpreter);

			expect(calls).toEqual(["changed"]);
		});

		it("fires when unobserve is called", () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			registry.observe("local", interpreter);

			const calls: string[] = [];
			registry.onWorkflowsChange(() => calls.push("changed"));

			registry.unobserve("local");

			expect(calls).toEqual(["changed"]);
		});

		it("returns an unsubscribe function", () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({}, storage);

			const calls: string[] = [];
			const unsub = registry.onWorkflowsChange(() => calls.push("changed"));

			unsub();

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			registry.observe("local", interpreter);

			expect(calls).toEqual([]);
		});
	});

	it("getWorkflowIds() returns all registered workflow IDs", () => {
		const workflowA: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("a", async () => "a");
		};
		const workflowB: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("b", async () => "b");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry(
			{ alpha: workflowA, beta: workflowB },
			storage,
		);

		const ids = registry.getWorkflowIds();
		expect(ids).toContain("alpha");
		expect(ids).toContain("beta");
		expect(ids).toHaveLength(2);
	});

	it("getEvents() returns events for a started workflow", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);
		await registry.start("greet");

		const events = registry.getEvents("greet");
		expect(events[0]).toMatchObject({ type: "workflow_started" });
		expect(events).toContainEqual(
			expect.objectContaining({ type: "workflow_completed", result: "hello" }),
		);
	});

	it("getEvents() returns empty array for an unstarted workflow", () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);

		const events = registry.getEvents("greet");
		expect(events).toEqual([]);
	});

	it("onStateChange returns unsubscribe function", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const data = yield* ctx.waitFor<string>("submit");
			return `got: ${data}`;
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ form: workflow }, storage);

		const states: string[] = [];
		const unsubscribe = registry.onStateChange("form", () => {
			const s = registry.getState("form");
			if (s) states.push(s);
		});

		const startPromise = registry.start("form");

		// Wait for waiting state
		await new Promise((r) => setTimeout(r, 10));

		// Unsubscribe before signal
		unsubscribe();

		registry.signal("form", "submit", "data");
		await startPromise;

		// Should NOT have received the completed notification
		expect(states).not.toContain("completed");
	});
});

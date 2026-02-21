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

	it("compacts storage after workflow completes", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);
		await registry.start("greet");

		const events = await storage.load("greet");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "workflow_completed",
			result: "hello",
		});
	});

	it("compacts storage after workflow fails", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("fail", async () => {
				throw new Error("boom");
			});
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ fail: workflow }, storage);
		await registry.start("fail");

		const events = await storage.load("fail");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "workflow_failed",
			error: "boom",
		});
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

	describe("reset", () => {
		it("reset() cancels, clears storage, and allows restart", async () => {
			let runCount = 0;
			const workflow: WorkflowFunction<number> = function* (ctx) {
				runCount++;
				return yield* ctx.activity("count", async () => runCount);
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ counter: workflow }, storage);

			await registry.start("counter");
			expect(registry.getState("counter")).toBe("completed");
			expect(await registry.waitFor("counter")).toBe(1);

			await registry.reset("counter");

			// Entry should be reset — no interpreter, not completed
			expect(registry.getState("counter")).toBeUndefined();

			// Storage should be cleared
			const events = await storage.load("counter");
			expect(events).toEqual([]);

			// Can start again
			await registry.start("counter");
			expect(registry.getState("counter")).toBe("completed");
			expect(await registry.waitFor("counter")).toBe(2);
		});

		it("reset() cancels a waiting workflow", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ form: workflow }, storage);

			const startPromise = registry.start("form");
			await new Promise((r) => setTimeout(r, 10));

			expect(registry.getState("form")).toBe("waiting");

			await registry.reset("form");
			await startPromise;

			// Should be reset, not waiting
			expect(registry.getState("form")).toBeUndefined();
		});

		it("reset() notifies state change listeners", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry({ form: workflow }, storage);

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
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: workflow }, storage);

		const events = registry.getEvents("greet");
		expect(events).toEqual([]);
	});

	describe("circular dependency detection", () => {
		it("detects a direct cycle (A → B → A)", async () => {
			const workflowA: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ B: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("B");
			};

			const workflowB: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ A: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("A");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ A: workflowA, B: workflowB },
				storage,
			);

			await registry.start("A");

			expect(registry.getState("A")).toBe("failed");
			const interpreter = registry.getInterpreter("A");
			expect(interpreter?.error).toMatch(/Circular dependency/);
			expect(interpreter?.error).toContain("A");
			expect(interpreter?.error).toContain("B");
		});

		it("detects a transitive cycle (A → B → C → A)", async () => {
			const workflowA: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ B: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("B");
			};

			const workflowB: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ C: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("C");
			};

			const workflowC: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ A: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("A");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ A: workflowA, B: workflowB, C: workflowC },
				storage,
			);

			await registry.start("A");

			expect(registry.getState("A")).toBe("failed");
			const interpreter = registry.getInterpreter("A");
			expect(interpreter?.error).toMatch(/Circular dependency/);
			expect(interpreter?.error).toContain("A");
			expect(interpreter?.error).toContain("B");
			expect(interpreter?.error).toContain("C");
		});

		it("does not false-positive when two workflows depend on the same target", async () => {
			const workflowTarget: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const workflowA: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ target: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("target");
			};

			const workflowC: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ target: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("target");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ target: workflowTarget, A: workflowA, C: workflowC },
				storage,
			);

			await registry.start("A");
			await registry.start("C");

			expect(registry.getState("A")).toBe("completed");
			expect(registry.getState("C")).toBe("completed");
			expect(await registry.waitFor("A")).toBe("hello");
			expect(await registry.waitFor("C")).toBe("hello");
		});

		it("detects a cycle through waitForAll with workflow refs", async () => {
			const workflowA: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ B: string }
			> = function* (ctx) {
				const [result] = yield* ctx.waitForAll(ctx.workflow("B"));
				return result;
			};

			const workflowB: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ A: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("A");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ A: workflowA, B: workflowB },
				storage,
			);

			await registry.start("A");

			expect(registry.getState("A")).toBe("failed");
			const interpreter = registry.getInterpreter("A");
			expect(interpreter?.error).toMatch(/Circular dependency/);
		});

		it("cleans up dependency edges after workflow completes", async () => {
			const workflowA: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const workflowB: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ A: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("A");
			};

			const workflowC: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ B: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("B");
			};

			const storage = new MemoryStorage();
			const registry = new WorkflowRegistry(
				{ A: workflowA, B: workflowB, C: workflowC },
				storage,
			);

			// B depends on A; after both complete, starting C (which depends on B) should work
			await registry.start("B");
			expect(registry.getState("B")).toBe("completed");

			await registry.start("C");
			expect(registry.getState("C")).toBe("completed");
			expect(await registry.waitFor("C")).toBe("hello");
		});
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

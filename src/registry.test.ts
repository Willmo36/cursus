// ABOUTME: Tests for the WorkflowRegistry that manages shared workflow instances.
// ABOUTME: Covers start, waitFor, signal, persistence, and failure handling.

import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";
import { WorkflowRegistry } from "./registry";

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

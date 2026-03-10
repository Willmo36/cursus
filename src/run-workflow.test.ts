// ABOUTME: Tests for server-side workflow execution.
// ABOUTME: Covers runWorkflow() returning snapshots for completed, failed, and waiting workflows.

import { describe, expect, it } from "vitest";
import { runWorkflow } from "./run-workflow";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";

describe("runWorkflow", () => {
	it("returns snapshot with completed state and result", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const snapshot = await runWorkflow("test-1", workflow);

		expect(snapshot.workflowId).toBe("test-1");
		expect(snapshot.state).toBe("completed");
		expect(snapshot.result).toBe("hello");
		expect(snapshot.error).toBeUndefined();
	});

	it("returns snapshot with events array", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const snapshot = await runWorkflow("test-2", workflow);

		expect(snapshot.events.length).toBeGreaterThan(0);
		expect(snapshot.events[0].type).toBe("workflow_started");
		const completedEvent = snapshot.events.find(
			(e) => e.type === "workflow_completed",
		);
		expect(completedEvent).toBeDefined();
	});

	it("captures published value in snapshot", async () => {
		const workflow: WorkflowFunction<
			string,
			Record<string, unknown>,
			Record<string, never>,
			string
		> = function* (ctx) {
			yield* ctx.publish("intermediate");
			return yield* ctx.activity("work", async () => "done");
		};

		const snapshot = await runWorkflow("test-3", workflow);

		expect(snapshot.published).toBe("intermediate");
		expect(snapshot.state).toBe("completed");
		expect(snapshot.result).toBe("done");
	});

	it("returns failed state when workflow throws", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("fail", async () => {
				throw new Error("boom");
			});
		};

		const snapshot = await runWorkflow("test-4", workflow);

		expect(snapshot.state).toBe("failed");
		expect(snapshot.error).toBe("boom");
		expect(snapshot.result).toBeUndefined();
	});

	it("returns waiting state when workflow blocks on signal", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const data = yield* ctx.waitFor("submit");
			return `got: ${data}`;
		};

		const snapshot = await runWorkflow("test-5", workflow);

		expect(snapshot.state).toBe("waiting");
		expect(snapshot.result).toBeUndefined();
		expect(snapshot.error).toBeUndefined();
		expect(snapshot.events.length).toBeGreaterThan(0);
		expect(snapshot.waitingFor).toBe("submit");
	});

	it("includes waitingFor in snapshot for SSR hydration", async () => {
		const workflow: WorkflowFunction<string, { confirm: boolean }> = function* (
			ctx,
		) {
			yield* ctx.activity("prep", async () => "prepared");
			const confirmed = yield* ctx.waitFor("confirm");
			return confirmed ? "confirmed" : "denied";
		};

		const snapshot = await runWorkflow("test-waiting", workflow);

		expect(snapshot.state).toBe("waiting");
		expect(snapshot.waitingFor).toBe("confirm");
		expect(snapshot.waitingForAll).toBeUndefined();
		expect(snapshot.waitingForAny).toBeUndefined();
	});

	it("uses provided storage", async () => {
		const storage = new MemoryStorage();
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const snapshot = await runWorkflow("test-6", workflow, { storage });

		expect(snapshot.state).toBe("completed");

		// Events should be persisted to the provided storage
		const storedEvents = await storage.load("test-6");
		expect(storedEvents.length).toBeGreaterThan(0);
	});
});

// ABOUTME: Tests for server-side workflow execution.
// ABOUTME: Covers runWorkflow() returning snapshots for completed, failed, and waiting workflows.

import { describe, expect, it } from "vitest";
import { runWorkflow } from "./run-workflow";
import { MemoryStorage } from "./storage";
import { workflow } from "./types";
import type { WorkflowContext } from "./types";

describe("runWorkflow", () => {
	it("returns snapshot with completed state and result", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("greet", async () => "hello");
		});

		const snapshot = await runWorkflow("test-1", wf);

		expect(snapshot.workflowId).toBe("test-1");
		expect(snapshot.state).toBe("completed");
		expect(snapshot.result).toBe("hello");
		expect(snapshot.error).toBeUndefined();
	});

	it("returns snapshot with events array", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("greet", async () => "hello");
		});

		const snapshot = await runWorkflow("test-2", wf);

		expect(snapshot.events.length).toBeGreaterThan(0);
		expect(snapshot.events[0].type).toBe("workflow_started");
		const completedEvent = snapshot.events.find(
			(e) => e.type === "workflow_completed",
		);
		expect(completedEvent).toBeDefined();
	});

	it("captures published value in snapshot", async () => {
		const wf = workflow(function* (ctx: WorkflowContext<Record<string, unknown>, Record<string, never>, string>) {
			yield* ctx.publish("intermediate");
			return yield* ctx.activity("work", async () => "done");
		});

		const snapshot = await runWorkflow("test-3", wf);

		expect(snapshot.published).toBe("intermediate");
		expect(snapshot.state).toBe("completed");
		expect(snapshot.result).toBe("done");
	});

	it("returns failed state when workflow throws", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("fail", async () => {
				throw new Error("boom");
			});
		});

		const snapshot = await runWorkflow("test-4", wf);

		expect(snapshot.state).toBe("failed");
		expect(snapshot.error).toBe("boom");
		expect(snapshot.result).toBeUndefined();
	});

	it("returns waiting state when workflow blocks on signal", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			const data = yield* ctx.receive("submit");
			return `got: ${data}`;
		});

		const snapshot = await runWorkflow("test-5", wf);

		expect(snapshot.state).toBe("waiting");
		expect(snapshot.result).toBeUndefined();
		expect(snapshot.error).toBeUndefined();
		expect(snapshot.events.length).toBeGreaterThan(0);
		expect(snapshot.receiving).toBe("submit");
	});

	it("includes receiving in snapshot for SSR hydration", async () => {
		const wf = workflow(function* (ctx: WorkflowContext<{ confirm: boolean }>) {
			yield* ctx.activity("prep", async () => "prepared");
			const confirmed = yield* ctx.receive("confirm");
			return confirmed ? "confirmed" : "denied";
		});

		const snapshot = await runWorkflow("test-waiting", wf);

		expect(snapshot.state).toBe("waiting");
		expect(snapshot.receiving).toBe("confirm");
		expect(snapshot.receivingAll).toBeUndefined();
		expect(snapshot.receivingAny).toBeUndefined();
	});

	it("uses provided storage", async () => {
		const storage = new MemoryStorage();
		const wf = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("greet", async () => "hello");
		});

		const snapshot = await runWorkflow("test-6", wf, { storage });

		expect(snapshot.state).toBe("completed");

		// Events should be persisted to the provided storage
		const storedEvents = await storage.load("test-6");
		expect(storedEvents.length).toBeGreaterThan(0);
	});
});

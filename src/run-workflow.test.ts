// ABOUTME: Tests for server-side workflow execution.
// ABOUTME: Covers runWorkflow() returning snapshots for completed, failed, and waiting workflows.

import { describe, expect, it } from "vitest";
import { runWorkflow } from "./run-workflow";
import { MemoryStorage } from "./storage";
import { activity, publish, receive, workflow } from "./types";

describe("runWorkflow", () => {
	it("returns snapshot with completed state and result", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const snapshot = await runWorkflow("test-1", wf);

		expect(snapshot.workflowId).toBe("test-1");
		expect(snapshot.state).toEqual({ status: "completed", result: "hello" });
	});

	it("returns snapshot with events array", async () => {
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
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
		const wf = workflow(function* () {
			yield* publish("intermediate");
			return yield* activity("work", async () => "done");
		});

		const snapshot = await runWorkflow("test-3", wf);

		expect(snapshot.published).toBe("intermediate");
		expect(snapshot.state).toEqual({ status: "completed", result: "done" });
	});

	it("returns failed state when workflow throws", async () => {
		const wf = workflow(function* () {
			return yield* activity("fail", async () => {
				throw new Error("boom");
			});
		});

		const snapshot = await runWorkflow("test-4", wf);

		expect(snapshot.state).toEqual({ status: "failed", error: "boom" });
	});

	it("returns waiting state when workflow blocks on signal", async () => {
		const wf = workflow(function* () {
			const data = yield* receive("submit");
			return `got: ${data}`;
		});

		const snapshot = await runWorkflow("test-5", wf);

		expect(snapshot.state).toEqual({ status: "waiting" });
		expect(snapshot.events.length).toBeGreaterThan(0);
	});

	it("includes receiving in snapshot for SSR hydration", async () => {
		const wf = workflow(function* () {
			yield* activity("prep", async () => "prepared");
			const confirmed = yield* receive("confirm");
			return confirmed ? "confirmed" : "denied";
		});

		const snapshot = await runWorkflow("test-waiting", wf);

		expect(snapshot.state).toEqual({ status: "waiting" });
	});

	it("uses provided storage", async () => {
		const storage = new MemoryStorage();
		const wf = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const snapshot = await runWorkflow("test-6", wf, { storage });

		expect(snapshot.state).toEqual({ status: "completed", result: "hello" });

		// Events should be persisted to the provided storage
		const storedEvents = await storage.load("test-6");
		expect(storedEvents.length).toBeGreaterThan(0);
	});
});

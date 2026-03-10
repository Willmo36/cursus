// ABOUTME: Tests for the useWorkflowEvents hook.
// ABOUTME: Covers empty state, realtime events, signal updates, and provider requirement.

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { createLayer } from "./layer";
import { WorkflowLayerProvider } from "./layer-provider";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";
import { useWorkflow } from "./use-workflow";
import { useWorkflowEvents } from "./use-workflow-events";

function createWrapper(
	workflows: Record<string, WorkflowFunction<unknown>>,
	storage: MemoryStorage,
) {
	const layer = createLayer(workflows, storage);
	return ({ children }: { children: ReactNode }) =>
		createElement(WorkflowLayerProvider, { layer }, children);
}

describe("useWorkflowEvents", () => {
	it("returns empty events array before workflows start", () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({ greet: workflow }, storage);

		const { result } = renderHook(() => useWorkflowEvents(), { wrapper });

		const greetLog = result.current.find((l) => l.id === "greet");
		expect(greetLog).toBeDefined();
		expect(greetLog?.events).toEqual([]);
	});

	it("returns events in realtime as workflow progresses", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({ greet: workflow }, storage);

		const { result } = renderHook(
			() => ({
				events: useWorkflowEvents(),
				wf: useWorkflow("greet"),
			}),
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.wf.state).toBe("completed");
		});

		await waitFor(() => {
			const greetLog = result.current.events.find((l) => l.id === "greet");
			expect(greetLog?.events.length).toBeGreaterThan(0);
			expect(greetLog?.events[0]).toMatchObject({ type: "workflow_started" });
			expect(greetLog?.events).toContainEqual(
				expect.objectContaining({ type: "workflow_completed" }),
			);
		});
	});

	it("updates events when a signal is sent to a waiting workflow", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const data = yield* ctx.receive<string>("submit");
			return `got: ${data}`;
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({ form: workflow }, storage);

		const { result } = renderHook(
			() => ({
				events: useWorkflowEvents(),
				wf: useWorkflow("form"),
			}),
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.wf.state).toBe("waiting");
		});

		// Events should include workflow_started at minimum
		await waitFor(() => {
			const formLog = result.current.events.find((l) => l.id === "form");
			expect(formLog?.events[0]).toMatchObject({ type: "workflow_started" });
		});

		act(() => {
			result.current.wf.signal("submit", "form-data");
		});

		await waitFor(() => {
			expect(result.current.wf.state).toBe("completed");
		});

		await waitFor(() => {
			const formLog = result.current.events.find((l) => l.id === "form");
			expect(formLog?.events).toContainEqual(
				expect.objectContaining({ type: "signal_received", signal: "submit" }),
			);
			expect(formLog?.events).toContainEqual(
				expect.objectContaining({ type: "workflow_completed" }),
			);
		});
	});

	it("shows all events for a local workflow that completes", async () => {
		const localWorkflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("compute", async () => "result");
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({}, storage);

		const { result } = renderHook(
			() => ({
				events: useWorkflowEvents(),
				local: useWorkflow("local", localWorkflow, { storage }),
			}),
			{ wrapper },
		);

		// First: verify the local workflow ID appears in events
		await waitFor(() => {
			const ids = result.current.events.map((l) => l.id);
			expect(ids).toContain("local");
		});

		// Then: verify the workflow completes
		await waitFor(() => {
			expect(result.current.local.state).toBe("completed");
		});

		// Finally: verify events are visible
		await waitFor(() => {
			const localLog = result.current.events.find((l) => l.id === "local");
			expect(localLog?.events).toContainEqual(
				expect.objectContaining({ type: "workflow_completed" }),
			);
		});
	});

	it("shows all events for a local workflow that completes with signals", async () => {
		const localWorkflow: WorkflowFunction<string> = function* (ctx) {
			const data = yield* ctx.receive<string>("submit");
			return yield* ctx.activity("process", async () => `processed: ${data}`);
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({}, storage);

		const { result } = renderHook(
			() => ({
				events: useWorkflowEvents(),
				local: useWorkflow("local", localWorkflow, { storage }),
			}),
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.local.state).toBe("waiting");
		});

		act(() => {
			result.current.local.signal("submit", "test-data");
		});

		await waitFor(() => {
			expect(result.current.local.state).toBe("completed");
		});

		await waitFor(() => {
			const localLog = result.current.events.find((l) => l.id === "local");
			expect(localLog).toBeDefined();
			expect(localLog?.events).toContainEqual(
				expect.objectContaining({
					type: "signal_received",
					signal: "submit",
				}),
			);
			expect(localLog?.events).toContainEqual(
				expect.objectContaining({ type: "workflow_completed" }),
			);
		});
	});

	it("throws when used outside a provider", () => {
		expect(() => {
			renderHook(() => useWorkflowEvents());
		}).toThrow(/WorkflowLayerProvider/);
	});
});

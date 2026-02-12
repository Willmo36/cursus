// ABOUTME: Tests for the useWorkflowEvents hook.
// ABOUTME: Covers empty state, realtime events, signal updates, and provider requirement.

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { WorkflowRegistryProvider } from "./registry-provider";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";
import { useGlobalWorkflow } from "./use-global-workflow";
import { useWorkflowEvents } from "./use-workflow-events";

function createWrapper(
	workflows: Record<string, WorkflowFunction<unknown>>,
	storage: MemoryStorage,
) {
	return ({ children }: { children: ReactNode }) =>
		createElement(WorkflowRegistryProvider, { workflows, storage }, children);
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
		expect(greetLog!.events).toEqual([]);
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
				wf: useGlobalWorkflow("greet"),
			}),
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.wf.state).toBe("completed");
		});

		await waitFor(() => {
			const greetLog = result.current.events.find((l) => l.id === "greet");
			expect(greetLog!.events.length).toBeGreaterThan(0);
			expect(greetLog!.events[0]).toMatchObject({ type: "workflow_started" });
			expect(greetLog!.events).toContainEqual(
				expect.objectContaining({ type: "workflow_completed" }),
			);
		});
	});

	it("updates events when a signal is sent to a waiting workflow", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const data = yield* ctx.waitFor<string>("submit");
			return `got: ${data}`;
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({ form: workflow }, storage);

		const { result } = renderHook(
			() => ({
				events: useWorkflowEvents(),
				wf: useGlobalWorkflow("form"),
			}),
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.wf.state).toBe("waiting");
		});

		// Events should include workflow_started at minimum
		await waitFor(() => {
			const formLog = result.current.events.find((l) => l.id === "form");
			expect(formLog!.events[0]).toMatchObject({ type: "workflow_started" });
		});

		act(() => {
			result.current.wf.signal("submit", "form-data");
		});

		await waitFor(() => {
			expect(result.current.wf.state).toBe("completed");
		});

		await waitFor(() => {
			const formLog = result.current.events.find((l) => l.id === "form");
			expect(formLog!.events).toContainEqual(
				expect.objectContaining({ type: "signal_received", signal: "submit" }),
			);
			expect(formLog!.events).toContainEqual(
				expect.objectContaining({ type: "workflow_completed" }),
			);
		});
	});

	it("throws when used outside a provider", () => {
		expect(() => {
			renderHook(() => useWorkflowEvents());
		}).toThrow(/WorkflowRegistryProvider/);
	});
});

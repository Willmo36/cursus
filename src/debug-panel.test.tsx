// ABOUTME: Tests for the WorkflowDebugPanel component.
// ABOUTME: Covers collapsed/expanded states, event display, clear callback, and multiple workflows.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildTimelineData, WorkflowDebugPanel } from "./debug-panel";
import { createLayer } from "./layer";
import { WorkflowLayerProvider } from "./layer-provider";
import { MemoryStorage } from "./storage";
import type { WorkflowEvent, WorkflowFunction } from "./types";
import { useWorkflow } from "./use-workflow";
import type { WorkflowEventLog } from "./use-workflow-events";

function createWrapper(
	workflows: Record<string, WorkflowFunction<unknown>>,
	storage: MemoryStorage,
) {
	const layer = createLayer(workflows, storage);
	return ({ children }: { children: ReactNode }) =>
		createElement(WorkflowLayerProvider, { layer }, children);
}

describe("WorkflowDebugPanel", () => {
	it("renders collapsed by default with toggle button", () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: workflow }, storage);

		render(createElement(Wrapper, null, createElement(WorkflowDebugPanel)));

		expect(screen.getByText(/Show Debug Panel/)).toBeInTheDocument();
	});

	it("shows event table when expanded", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: workflow }, storage);

		function TestApp() {
			useWorkflow("greet");
			return createElement(WorkflowDebugPanel);
		}

		render(createElement(Wrapper, null, createElement(TestApp)));

		// Wait for workflow to complete
		await waitFor(() => {
			expect(screen.getByText(/events\)/)).toBeInTheDocument();
		});

		const user = userEvent.setup();
		await user.click(screen.getByText(/Debug Panel/));

		await waitFor(() => {
			expect(screen.getByText("Event Inspector")).toBeInTheDocument();
			expect(screen.getAllByText(/greet/).length).toBeGreaterThan(0);
			expect(screen.getByText(/4 events/)).toBeInTheDocument();
		});
	});

	it("calls onClear when clear button is clicked", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: workflow }, storage);
		const onClear = vi.fn();

		function TestApp() {
			useWorkflow("greet");
			return createElement(WorkflowDebugPanel, { onClear });
		}

		render(createElement(Wrapper, null, createElement(TestApp)));

		// Wait for events to load
		await waitFor(() => {
			expect(screen.getByText(/events\)/)).toBeInTheDocument();
		});

		const user = userEvent.setup();
		await user.click(screen.getByText(/Debug Panel/));

		await waitFor(() => {
			expect(screen.getByText("Clear All Storage")).toBeInTheDocument();
		});

		await user.click(screen.getByText("Clear All Storage"));
		expect(onClear).toHaveBeenCalledOnce();
	});

	it("renders Events and Timeline tabs when expanded, defaults to Events", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: workflow }, storage);

		function TestApp() {
			useWorkflow("greet");
			return createElement(WorkflowDebugPanel);
		}

		render(createElement(Wrapper, null, createElement(TestApp)));

		await waitFor(() => {
			expect(screen.getByText(/events\)/)).toBeInTheDocument();
		});

		const user = userEvent.setup();
		await user.click(screen.getByText(/Debug Panel/));

		await waitFor(() => {
			expect(screen.getByRole("tab", { name: "Events" })).toBeInTheDocument();
			expect(screen.getByRole("tab", { name: "Timeline" })).toBeInTheDocument();
			// Events tab is active by default — event table visible
			expect(screen.getByText("Event Inspector")).toBeInTheDocument();
		});
	});

	it("switches to Timeline tab and back to Events", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: workflow }, storage);

		function TestApp() {
			useWorkflow("greet");
			return createElement(WorkflowDebugPanel);
		}

		render(createElement(Wrapper, null, createElement(TestApp)));

		await waitFor(() => {
			expect(screen.getByText(/events\)/)).toBeInTheDocument();
		});

		const user = userEvent.setup();
		await user.click(screen.getByText(/Debug Panel/));

		await waitFor(() => {
			expect(screen.getByText("Event Inspector")).toBeInTheDocument();
		});

		// Switch to Timeline
		await user.click(screen.getByRole("tab", { name: "Timeline" }));

		await waitFor(() => {
			// Event table should be gone
			expect(screen.queryByText("Event Inspector")).not.toBeInTheDocument();
			// Timeline content should appear
			expect(screen.getByTestId("timeline-view")).toBeInTheDocument();
		});

		// Switch back to Events
		await user.click(screen.getByRole("tab", { name: "Events" }));

		await waitFor(() => {
			expect(screen.getByText("Event Inspector")).toBeInTheDocument();
			expect(screen.queryByTestId("timeline-view")).not.toBeInTheDocument();
		});
	});

	it("displays events for multiple workflows", async () => {
		const workflowA: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("a", async () => "alpha");
		};
		const workflowB: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("b", async () => "beta");
		};

		const storage = new MemoryStorage();
		const Wrapper = createWrapper(
			{ alpha: workflowA, beta: workflowB },
			storage,
		);

		function TestApp() {
			useWorkflow("alpha");
			useWorkflow("beta");
			return createElement(WorkflowDebugPanel);
		}

		render(createElement(Wrapper, null, createElement(TestApp)));

		const user = userEvent.setup();

		await waitFor(() => {
			expect(screen.getByText(/events\)/)).toBeInTheDocument();
		});

		await user.click(screen.getByText(/Debug Panel/));

		await waitFor(() => {
			expect(screen.getByText("alpha")).toBeInTheDocument();
			expect(screen.getByText("beta")).toBeInTheDocument();
		});
	});
});

describe("buildTimelineData", () => {
	const base = 1000;

	function makeLog(id: string, events: WorkflowEvent[]): WorkflowEventLog {
		return { id, events };
	}

	it("produces spans from paired start/end events", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{
					type: "activity_scheduled",
					name: "fetch",
					seq: 0,
					timestamp: base + 100,
				},
				{
					type: "activity_completed",
					seq: 0,
					result: "ok",
					timestamp: base + 500,
				},
				{ type: "workflow_completed", result: "done", timestamp: base + 600 },
			]),
		];

		const result = buildTimelineData(logs);
		expect(result.rows).toHaveLength(1);

		const row = result.rows[0];
		expect(row.workflowId).toBe("wf1");

		// Should have one span: activity_scheduled → activity_completed
		expect(row.spans).toHaveLength(1);
		const span = row.spans[0];
		expect(span.startType).toBe("activity_scheduled");
		expect(span.endType).toBe("activity_completed");
		expect(span.name).toBe("fetch");
		expect(span.seq).toBe(0);

		// Positions should be relative (0-1 range based on global time range)
		// global range = 600ms, activity starts at +100, ends at +500
		expect(span.startPos).toBeCloseTo(100 / 600);
		expect(span.endPos).toBeCloseTo(500 / 600);
	});

	it("produces markers for point events", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{
					type: "signal_received",
					signal: "submit",
					payload: { x: 1 },
					seq: 0,
					timestamp: base + 300,
				},
				{ type: "workflow_completed", result: "done", timestamp: base + 600 },
			]),
		];

		const result = buildTimelineData(logs);
		const row = result.rows[0];

		// Point events: workflow_started, signal_received, workflow_completed
		expect(row.markers).toHaveLength(3);

		const signal = row.markers.find((m) => m.type === "signal_received");
		expect(signal).toBeDefined();
		expect(signal?.pos).toBeCloseTo(300 / 600);
		expect(signal?.label).toBe("submit");
	});

	it("handles multiple workflows with global time normalization", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{ type: "workflow_completed", result: "a", timestamp: base + 200 },
			]),
			makeLog("wf2", [
				{ type: "workflow_started", timestamp: base + 100 },
				{ type: "workflow_completed", result: "b", timestamp: base + 500 },
			]),
		];

		const result = buildTimelineData(logs);
		expect(result.rows).toHaveLength(2);

		// Global range: base to base+500 = 500ms
		// wf1 started at base → pos 0, completed at base+200 → pos 0.4
		// wf2 started at base+100 → pos 0.2, completed at base+500 → pos 1.0
		const wf1 = result.rows.find((r) => r.workflowId === "wf1");
		const wf2 = result.rows.find((r) => r.workflowId === "wf2");
		expect(wf1).toBeDefined();
		expect(wf2).toBeDefined();
		if (!wf1 || !wf2) return;

		expect(wf1.markers[0].pos).toBeCloseTo(0);
		expect(wf1.markers[1].pos).toBeCloseTo(0.4);
		expect(wf2.markers[0].pos).toBeCloseTo(0.2);
		expect(wf2.markers[1].pos).toBeCloseTo(1.0);
	});

	it("pairs timer_started with timer_fired as a span", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{
					type: "timer_started",
					seq: 0,
					durationMs: 1000,
					timestamp: base + 50,
				},
				{ type: "timer_fired", seq: 0, timestamp: base + 1050 },
				{
					type: "workflow_completed",
					result: "done",
					timestamp: base + 1100,
				},
			]),
		];

		const result = buildTimelineData(logs);
		const row = result.rows[0];

		expect(row.spans).toHaveLength(1);
		expect(row.spans[0].startType).toBe("timer_started");
		expect(row.spans[0].endType).toBe("timer_fired");
	});

	it("returns empty rows for empty logs", () => {
		const result = buildTimelineData([]);
		expect(result.rows).toHaveLength(0);
	});

	it("handles single-event workflow without crashing", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [{ type: "workflow_started", timestamp: base }]),
		];

		const result = buildTimelineData(logs);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].markers).toHaveLength(1);
		expect(result.rows[0].markers[0].pos).toBe(0);
	});
});

describe("TimelineView rendering", () => {
	it("renders workflow rows with spans and markers", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("fetch", async () => "data");
		};

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ myflow: workflow }, storage);

		function TestApp() {
			useWorkflow("myflow");
			return createElement(WorkflowDebugPanel);
		}

		render(createElement(Wrapper, null, createElement(TestApp)));

		await waitFor(() => {
			expect(screen.getByText(/events\)/)).toBeInTheDocument();
		});

		const user = userEvent.setup();
		await user.click(screen.getByText(/Debug Panel/));
		await user.click(screen.getByRole("tab", { name: "Timeline" }));

		await waitFor(() => {
			const timeline = screen.getByTestId("timeline-view");
			expect(timeline).toBeInTheDocument();

			// Workflow label should appear
			expect(screen.getByText("myflow")).toBeInTheDocument();

			// Should have a span for the activity (scheduled → completed)
			expect(
				timeline.querySelector('[data-testid="timeline-span"]'),
			).toBeInTheDocument();

			// Should have markers for workflow_started and workflow_completed
			const markers = timeline.querySelectorAll(
				'[data-testid="timeline-marker"]',
			);
			expect(markers.length).toBeGreaterThanOrEqual(2);
		});
	});

	it("renders multiple workflow rows", async () => {
		const workflowA: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("a", async () => "alpha");
		};
		const workflowB: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("b", async () => "beta");
		};

		const storage = new MemoryStorage();
		const Wrapper = createWrapper(
			{ alpha: workflowA, beta: workflowB },
			storage,
		);

		function TestApp() {
			useWorkflow("alpha");
			useWorkflow("beta");
			return createElement(WorkflowDebugPanel);
		}

		render(createElement(Wrapper, null, createElement(TestApp)));

		await waitFor(() => {
			expect(screen.getByText(/events\)/)).toBeInTheDocument();
		});

		const user = userEvent.setup();
		await user.click(screen.getByText(/Debug Panel/));
		await user.click(screen.getByRole("tab", { name: "Timeline" }));

		await waitFor(() => {
			const rows = screen.getAllByTestId("timeline-row");
			expect(rows).toHaveLength(2);
		});
	});

	it("shows tooltip content on span hover", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("fetch", async () => "data");
		};

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ myflow: workflow }, storage);

		function TestApp() {
			useWorkflow("myflow");
			return createElement(WorkflowDebugPanel);
		}

		render(createElement(Wrapper, null, createElement(TestApp)));

		await waitFor(() => {
			expect(screen.getByText(/events\)/)).toBeInTheDocument();
		});

		const user = userEvent.setup();
		await user.click(screen.getByText(/Debug Panel/));
		await user.click(screen.getByRole("tab", { name: "Timeline" }));

		await waitFor(() => {
			const span = screen.getByTestId("timeline-span");
			expect(span).toBeInTheDocument();
			// Tooltip should contain the activity name
			expect(span.getAttribute("title")).toContain("fetch");
		});
	});
});

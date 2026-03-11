// ABOUTME: Tests for the WorkflowDebugPanel component.
// ABOUTME: Covers collapsed/expanded states, event display, clear callback, and multiple workflows.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkflowDebugPanel } from "./debug-panel";
import { createLayer } from "./layer";
import { WorkflowLayerProvider } from "./layer-provider";
import { MemoryStorage } from "./storage";
import { activity, workflow } from "./types";
import type { AnyWorkflowFunction } from "./types";
import { useWorkflow } from "./use-workflow";

function createWrapper(
	workflows: Record<string, AnyWorkflowFunction>,
	storage: MemoryStorage,
) {
	const layer = createLayer(workflows, storage);
	return ({ children }: { children: ReactNode }) =>
		createElement(WorkflowLayerProvider, { layer }, children);
}

describe("WorkflowDebugPanel", () => {
	it("renders collapsed by default with toggle button", () => {
		const greetWorkflow = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: greetWorkflow }, storage);

		render(createElement(Wrapper, null, createElement(WorkflowDebugPanel)));

		expect(screen.getByText(/Show Debug Panel/)).toBeInTheDocument();
	});

	it("shows event table when expanded", async () => {
		const greetWorkflow = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: greetWorkflow }, storage);

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
		const greetWorkflow = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: greetWorkflow }, storage);
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
		const greetWorkflow = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: greetWorkflow }, storage);

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
		const greetWorkflow = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ greet: greetWorkflow }, storage);

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
		const workflowA = workflow(function* () {
			return yield* activity("a", async () => "alpha");
		});
		const workflowB = workflow(function* () {
			return yield* activity("b", async () => "beta");
		});

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

describe("TimelineView rendering", () => {
	it("renders workflow rows with spans and markers", async () => {
		const fetchWorkflow = workflow(function* () {
			return yield* activity("fetch", async () => "data");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ myflow: fetchWorkflow }, storage);

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
		const workflowA = workflow(function* () {
			return yield* activity("a", async () => "alpha");
		});
		const workflowB = workflow(function* () {
			return yield* activity("b", async () => "beta");
		});

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

	it("renders time axis with tick labels", async () => {
		const fetchWorkflow = workflow(function* () {
			return yield* activity("fetch", async () => "data");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ myflow: fetchWorkflow }, storage);

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
			const axis = screen.getByTestId("timeline-axis");
			expect(axis).toBeInTheDocument();
			// Should have at least one tick label
			const ticks = axis.querySelectorAll('[data-testid="timeline-tick"]');
			expect(ticks.length).toBeGreaterThanOrEqual(1);
		});
	});

	it("shows span name as inline label", async () => {
		const fetchWorkflow = workflow(function* () {
			return yield* activity("fetch", async () => "data");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ myflow: fetchWorkflow }, storage);

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
			// The span should contain the activity name as inline text
			expect(span.textContent).toContain("fetch");
		});
	});

	it("renders a color legend", async () => {
		const fetchWorkflow = workflow(function* () {
			return yield* activity("fetch", async () => "data");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ myflow: fetchWorkflow }, storage);

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
			const legend = screen.getByTestId("timeline-legend");
			expect(legend).toBeInTheDocument();
			expect(legend.textContent).toContain("Scheduled");
			expect(legend.textContent).toContain("Completed");
			expect(legend.textContent).toContain("Failed");
			expect(legend.textContent).toContain("Signal");
		});
	});

	it("shows tooltip content on span hover", async () => {
		const fetchWorkflow = workflow(function* () {
			return yield* activity("fetch", async () => "data");
		});

		const storage = new MemoryStorage();
		const Wrapper = createWrapper({ myflow: fetchWorkflow }, storage);

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

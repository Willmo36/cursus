// ABOUTME: Tests for the WorkflowDebugPanel component.
// ABOUTME: Covers collapsed/expanded states, event display, clear callback, and multiple workflows.

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkflowDebugPanel } from "./debug-panel";
import { WorkflowRegistryProvider } from "./registry-provider";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";
import { useGlobalWorkflow } from "./use-global-workflow";

function createWrapper(
	workflows: Record<string, WorkflowFunction<unknown>>,
	storage: MemoryStorage,
) {
	return ({ children }: { children: ReactNode }) =>
		createElement(WorkflowRegistryProvider, { workflows, storage }, children);
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
			useGlobalWorkflow("greet");
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
			useGlobalWorkflow("greet");
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
			useGlobalWorkflow("alpha");
			useGlobalWorkflow("beta");
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

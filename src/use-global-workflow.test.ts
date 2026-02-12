// ABOUTME: Tests for the useGlobalWorkflow React hook.
// ABOUTME: Covers state, signal, auto-start, reactive updates, and error outside provider.

import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { WorkflowRegistryProvider } from "./registry-provider";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";
import { useGlobalWorkflow } from "./use-global-workflow";

function createWrapper(
	workflows: Record<string, WorkflowFunction<unknown>>,
	storage: MemoryStorage,
) {
	return ({ children }: { children: ReactNode }) =>
		createElement(
			WorkflowRegistryProvider,
			{ workflows, storage },
			children,
		);
}

describe("useGlobalWorkflow", () => {
	it("returns same shape as useWorkflow (state, result, signal, etc.)", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({ greet: workflow }, storage);

		const { result } = renderHook(() => useGlobalWorkflow("greet"), {
			wrapper,
		});

		expect(result.current).toHaveProperty("state");
		expect(result.current).toHaveProperty("result");
		expect(result.current).toHaveProperty("error");
		expect(result.current).toHaveProperty("waitingFor");
		expect(result.current).toHaveProperty("signal");
		expect(result.current).toHaveProperty("reset");

		await waitFor(() => {
			expect(result.current.state).toBe("completed");
			expect(result.current.result).toBe("hello");
		});
	});

	it("auto-starts the global workflow on mount", async () => {
		let started = false;
		const workflow: WorkflowFunction<string> = function* (ctx) {
			started = true;
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({ greet: workflow }, storage);

		renderHook(() => useGlobalWorkflow("greet"), { wrapper });

		await waitFor(() => {
			expect(started).toBe(true);
		});
	});

	it("signal() sends signals to the global workflow's interpreter", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const data = yield* ctx.waitFor<string>("submit");
			return `got: ${data}`;
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({ form: workflow }, storage);

		const { result } = renderHook(() => useGlobalWorkflow("form"), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.state).toBe("waiting");
			expect(result.current.waitingFor).toBe("submit");
		});

		act(() => {
			result.current.signal("submit", "form-data");
		});

		await waitFor(() => {
			expect(result.current.state).toBe("completed");
			expect(result.current.result).toBe("got: form-data");
		});
	});

	it("state / waitingFor reactively updates as global workflow progresses", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const a = yield* ctx.waitFor<string>("step1");
			const b = yield* ctx.waitFor<string>("step2");
			return `${a}:${b}`;
		};

		const storage = new MemoryStorage();
		const wrapper = createWrapper({ multi: workflow }, storage);

		const { result } = renderHook(() => useGlobalWorkflow("multi"), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.waitingFor).toBe("step1");
		});

		act(() => {
			result.current.signal("step1", "val1");
		});

		await waitFor(() => {
			expect(result.current.waitingFor).toBe("step2");
		});

		act(() => {
			result.current.signal("step2", "val2");
		});

		await waitFor(() => {
			expect(result.current.state).toBe("completed");
			expect(result.current.result).toBe("val1:val2");
		});
	});

	it("throws when used outside a provider", () => {
		expect(() => {
			renderHook(() => useGlobalWorkflow("anything"));
		}).toThrow(/WorkflowRegistryProvider/);
	});
});

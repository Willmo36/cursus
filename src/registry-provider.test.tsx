// ABOUTME: Tests for the WorkflowRegistryProvider React context.
// ABOUTME: Covers provider availability and hook error outside provider.

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";
import {
	WorkflowRegistryProvider,
	useWorkflowRegistry,
} from "./registry-provider";
import { WorkflowRegistry } from "./registry";

describe("WorkflowRegistryProvider", () => {
	it("makes registry available via useWorkflowRegistry()", () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const workflows = { greet: workflow };

		const wrapper = ({ children }: { children: ReactNode }) => (
			<WorkflowRegistryProvider workflows={workflows} storage={storage}>
				{children}
			</WorkflowRegistryProvider>
		);

		const { result } = renderHook(() => useWorkflowRegistry(), { wrapper });

		expect(result.current).toBeInstanceOf(WorkflowRegistry);
	});

	it("useWorkflowRegistry() throws outside provider", () => {
		expect(() => {
			renderHook(() => useWorkflowRegistry());
		}).toThrow(/WorkflowRegistryProvider/);
	});
});

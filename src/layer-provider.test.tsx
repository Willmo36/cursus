// ABOUTME: Tests for WorkflowLayerProvider React context.
// ABOUTME: Covers provider availability and registry creation from layer.

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createLayer } from "./layer";
import { useLayerRegistry, WorkflowLayerProvider } from "./layer-provider";
import { WorkflowRegistry } from "./registry";
import { MemoryStorage } from "./storage";
import { activity, workflow } from "./types";

describe("WorkflowLayerProvider", () => {
	it("makes registry available via context", () => {
		const greetWorkflow = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const layer = createLayer({ greet: greetWorkflow }, storage);

		const wrapper = ({ children }: { children: ReactNode }) => (
			<WorkflowLayerProvider layer={layer}>{children}</WorkflowLayerProvider>
		);

		const { result } = renderHook(() => useLayerRegistry(), { wrapper });

		expect(result.current).toBeInstanceOf(WorkflowRegistry);
	});

	it("throws when useLayerRegistry is used outside provider", () => {
		expect(() => {
			renderHook(() => useLayerRegistry());
		}).toThrow(/WorkflowLayerProvider/);
	});
});

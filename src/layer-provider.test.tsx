// ABOUTME: Tests for WorkflowLayerProvider React context.
// ABOUTME: Covers provider availability and registry creation from layer.

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createLayer } from "./layer";
import { WorkflowLayerProvider, useLayerRegistry } from "./layer-provider";
import { WorkflowRegistry } from "./registry";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";

describe("WorkflowLayerProvider", () => {
	it("makes registry available via context", () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const storage = new MemoryStorage();
		const layer = createLayer({ greet: workflow }, storage);

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

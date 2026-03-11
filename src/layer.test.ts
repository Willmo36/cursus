// ABOUTME: Tests for createLayer and WorkflowLayer.
// ABOUTME: Covers layer creation with typed workflows and storage.

import { describe, expect, it } from "vitest";
import { createLayer } from "./layer";
import { MemoryStorage } from "./storage";
import { workflow } from "./types";
import type { WorkflowContext } from "./types";

describe("createLayer", () => {
	it("returns a layer with workflows and storage", () => {
		const profileWorkflow = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("fetch", async () => ({ name: "Max" }));
		});

		const storage = new MemoryStorage();
		const layer = createLayer({ profile: profileWorkflow }, storage);

		expect(layer.workflows).toHaveProperty("profile");
		expect(layer.workflows.profile).toBe(profileWorkflow);
		expect(layer.storage).toBe(storage);
	});

	it("accepts and preserves versions option", () => {
		const wfA = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("a", async () => "a");
		});
		const wfB = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("b", async () => 42);
		});

		const storage = new MemoryStorage();
		const layer = createLayer<{ alpha: string; beta: number }>(
			{ alpha: wfA, beta: wfB },
			storage,
			{ versions: { alpha: 2 } },
		);

		expect(layer.versions).toEqual({ alpha: 2 });
	});

	it("accepts multiple workflows", () => {
		const wfA = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("a", async () => "a");
		});
		const wfB = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("b", async () => 42);
		});

		const storage = new MemoryStorage();
		const layer = createLayer({ alpha: wfA, beta: wfB }, storage);

		expect(Object.keys(layer.workflows)).toEqual(["alpha", "beta"]);
		expect(layer.storage).toBe(storage);
	});
});

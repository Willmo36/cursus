// ABOUTME: Creates a typed workflow layer that bundles workflows with storage.
// ABOUTME: Provides type inference for the layer's workflow result types.

import type { AnyWorkflowFunction, WorkflowStorage } from "./types";

export type WorkflowLayer<
	Provides extends Record<string, unknown> = Record<string, unknown>,
> = {
	workflows: { [K in keyof Provides]: AnyWorkflowFunction };
	storage: WorkflowStorage;
};

export function createLayer<
	Provides extends Record<string, unknown>,
>(
	workflows: { [K in keyof Provides]: AnyWorkflowFunction },
	storage: WorkflowStorage,
): WorkflowLayer<Provides> {
	return { workflows, storage };
}

// ABOUTME: Creates a typed workflow layer that bundles workflows with storage.
// ABOUTME: Provides type inference for the layer's workflow result types.

import type {
	AnyWorkflowFunction,
	WorkflowEventObserver,
	WorkflowStorage,
} from "./types";

export type WorkflowLayer<
	Provides extends Record<string, unknown> = Record<string, unknown>,
> = {
	workflows: { [K in keyof Provides]: AnyWorkflowFunction };
	storage: WorkflowStorage;
	onEvent?: WorkflowEventObserver[];
};

type CreateLayerOptions = {
	onEvent?: WorkflowEventObserver | WorkflowEventObserver[];
};

export function createLayer<Provides extends Record<string, unknown>>(
	workflows: { [K in keyof Provides]: AnyWorkflowFunction },
	storage: WorkflowStorage,
	options?: CreateLayerOptions,
): WorkflowLayer<Provides> {
	const onEvent = options?.onEvent
		? Array.isArray(options.onEvent)
			? options.onEvent
			: [options.onEvent]
		: undefined;
	return { workflows, storage, onEvent };
}

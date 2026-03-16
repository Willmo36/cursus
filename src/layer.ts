// ABOUTME: Creates a typed workflow layer that bundles workflows with storage.
// ABOUTME: Provides type inference for the layer's workflow result types.

import type {
	AnyWorkflow,
	WorkflowEventObserver,
	WorkflowStorage,
} from "./types";

export type WorkflowLayer<
	Provides extends Record<string, unknown> = Record<string, unknown>,
> = {
	workflows: { [K in keyof Provides]: AnyWorkflow };
	storage: WorkflowStorage;
	onEvent?: WorkflowEventObserver[];
	versions?: Partial<{ [K in keyof Provides]: number }>;
};

type CreateLayerOptions<Provides extends Record<string, unknown>> = {
	onEvent?: WorkflowEventObserver | WorkflowEventObserver[];
	versions?: Partial<{ [K in keyof Provides]: number }>;
};

export function createLayer<Provides extends Record<string, unknown>>(
	workflows: { [K in keyof Provides]: AnyWorkflow },
	storage: WorkflowStorage,
	options?: CreateLayerOptions<Provides>,
): WorkflowLayer<Provides> {
	const onEvent = options?.onEvent
		? Array.isArray(options.onEvent)
			? options.onEvent
			: [options.onEvent]
		: undefined;
	return { workflows, storage, onEvent, versions: options?.versions };
}

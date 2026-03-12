// ABOUTME: Creates pre-typed React bindings (hooks + provider) from a built registry.
// ABOUTME: Returned useWorkflow and Provider are locked to the registry's types at compile time.

import {
	createElement,
	type PropsWithChildren,
} from "react";
import type { Registry, RegistryEntry } from "./registry-builder";
import { RegistryContext } from "./registry-provider";
import { useWorkflow as useWorkflowBase } from "./use-workflow";
import type {
	CheckDeps,
	SignalMapOf,
	WorkflowReturn,
	WorkflowState,
} from "./types";

type UseWorkflowResult<T, SignalMap extends Record<string, unknown>> = {
	state: WorkflowState<T>;
	published: unknown;
	signal: <K extends keyof SignalMap & string>(
		name: K,
		payload: SignalMap[K],
	) => void;
	cancel: () => void;
	reset: () => void;
};

type UseWorkflowHook<Provides extends Record<string, RegistryEntry>> = {
	// Overload 1: registry workflow by ID
	<K extends keyof Provides & string>(
		workflowId: K,
	): UseWorkflowResult<Provides[K]["result"], Provides[K]["signals"]>;

	// Overload 2: inline workflow with dep checking
	// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
	<F extends (...args: any[]) => Generator<any, any, any>>(
		workflowId: string,
		workflowFn: F & CheckDeps<F, Provides>,
	): UseWorkflowResult<WorkflowReturn<F>, SignalMapOf<F>>;
};

export function createBindings<Provides extends Record<string, RegistryEntry>>(
	registry: Registry<Provides>,
) {
	function Provider({ children }: PropsWithChildren) {
		return createElement(
			RegistryContext.Provider,
			{ value: (registry as any)._registry },
			children,
		);
	}

	// biome-ignore lint/suspicious/noExplicitAny: runtime delegates to base useWorkflow
	const useWorkflow: UseWorkflowHook<Provides> = ((workflowId: string, workflowFn?: any) => {
		if (workflowFn) {
			return useWorkflowBase(workflowId, workflowFn);
		}
		return useWorkflowBase(workflowId, registry as any);
	}) as any;

	return { useWorkflow, Provider };
}

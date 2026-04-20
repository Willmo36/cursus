// ABOUTME: Creates pre-typed React bindings (hooks + provider) from a built registry.
// ABOUTME: Returned useWorkflow and Provider are locked to the registry's types at compile time.

import { createElement, type PropsWithChildren } from "react";
import type { Registry, RegistryEntry } from "./registry-builder";
import { RegistryContext } from "./registry-provider";
import type {
	AnyWorkflow,
	CheckDeps,
	SignalMapOf,
	Workflow,
	WorkflowReturn,
	WorkflowState,
} from "./types";
import { usePublished as usePublishedBase } from "./use-published";
import { useWorkflow as useWorkflowBase } from "./use-workflow";

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
	// biome-ignore lint/suspicious/noExplicitAny: need any for Workflow instance inference
	<W extends AnyWorkflow>(
		workflowId: string,
		workflowFn: W & CheckDeps<W, Provides>,
	): UseWorkflowResult<WorkflowReturn<W>, SignalMapOf<W>>;
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
	const useWorkflow: UseWorkflowHook<Provides> = ((
		workflowId: string,
		workflowFn?: any,
	) => {
		if (workflowFn) {
			return useWorkflowBase(workflowId, workflowFn);
		}
		return useWorkflowBase(workflowId, registry as any);
	}) as any;

	function usePublished<K extends keyof Provides & string, T>(
		workflowId: K,
		selector: (published: Provides[K]["published"]) => T,
	): T | undefined {
		return usePublishedBase(workflowId, selector as (published: unknown) => T);
	}

	return { useWorkflow, usePublished, Provider };
}

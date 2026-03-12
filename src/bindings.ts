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
	Published,
	Requirements,
	Result,
	SignalMapOf,
	WorkflowState,
} from "./types";

// Extracts Result dependency keys from a requirement union
type ResultDeps<R> = R extends Result<infer K, any> ? K : never;

// Extracts Published dependency keys from a requirement union
type PublishedDeps<R> = R extends Published<infer K, any> ? K : never;

// All dependency keys (Result + Published)
type DepKeys<R> = ResultDeps<R> | PublishedDeps<R>;

// Extracts requirements from a workflow function
// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
type ReqsOf<F> = F extends (...args: any[]) => Generator<any, any, any>
	? Requirements<ReturnType<F>>
	: never;

// Keys from R not in Provides
type UnsatisfiedDeps<R, Provides extends Record<string, unknown>> =
	Exclude<DepKeys<R>, keyof Provides>;

// If deps are satisfied, resolves to F. Otherwise resolves to a descriptive error string.
type CheckDeps<F, Provides extends Record<string, unknown>> =
	[UnsatisfiedDeps<ReqsOf<F>, Provides>] extends [never]
		? F
		: `Missing dependencies: ${UnsatisfiedDeps<ReqsOf<F>, Provides> & string}`;

// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
type WorkflowReturn<F> = F extends (...args: any[]) => Generator<any, infer T, any> ? T : never;

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

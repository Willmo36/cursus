// ABOUTME: React hook that runs a durable workflow via the registry and provides reactive state.
// ABOUTME: Requires a registry Provider in the component tree.

import {
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import type { Registry, RegistryEntry } from "./registry-builder";
import { RegistryContext } from "./registry-provider";
import type {
	ReceiveMapOf,
	Workflow,
	WorkflowState,
} from "./types";

type UseWorkflowResult<
	T,
	ReceiveMap extends Record<string, unknown> = Record<string, unknown>,
> = {
	state: WorkflowState<T>;
	published: unknown;
	signal: <K extends keyof ReceiveMap & string>(
		name: K,
		payload: ReceiveMap[K],
	) => void;
	cancel: () => void;
	reset: () => void;
};

// Overload 1: consume a workflow from the registry by ID (untyped)
export function useWorkflow<T = unknown>(
	workflowId: string,
): UseWorkflowResult<T, Record<string, unknown>>;

// Overload 2: consume a workflow from a typed registry
export function useWorkflow<
	P extends Record<string, RegistryEntry>,
	K extends keyof P & string,
>(
	workflowId: K,
	registry: Registry<P>,
): UseWorkflowResult<P[K]["result"], P[K]["signals"]>;

// Implementation
export function useWorkflow(
	workflowId: string,
	explicitRegistry?: Registry<any>,
): UseWorkflowResult<unknown, Record<string, unknown>> {
	const contextRegistry = useContext(RegistryContext);
	const resolved = explicitRegistry?._registry ?? contextRegistry;

	if (!resolved) {
		throw new Error(
			"useWorkflow requires a registry Provider in the component tree",
		);
	}

	const registry = resolved;

	const [state, setState] = useState<WorkflowState>(
		() => registry.getState(workflowId) ?? { status: "running" },
	);
	const [published, setPublished] = useState<unknown>(
		() => registry.getInterpreter(workflowId)?.published,
	);

	useEffect(() => {
		let cancelled = false;

		function syncState() {
			if (cancelled) return;
			const interpreter = registry.getInterpreter(workflowId);
			if (!interpreter) return;
			setState(interpreter.state);
			setPublished(interpreter.published);
		}

		const unsubscribe = registry.onStateChange(workflowId, syncState);

		registry.start(workflowId).then(() => {
			if (!cancelled) syncState();
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [workflowId, registry]);

	const signal = useCallback(
		(name: string, payload?: unknown) => {
			registry.signal(workflowId, name, payload);
		},
		[registry, workflowId],
	);

	const cancel = useCallback(() => {
		registry.getInterpreter(workflowId)?.cancel();
	}, [registry, workflowId]);

	const reset = useCallback(async () => {
		await registry.reset(workflowId);
		setState({ status: "running" });
		setPublished(undefined);
		await registry.start(workflowId);
	}, [registry, workflowId]);

	return {
		state,
		published,
		signal,
		cancel,
		reset,
	};
}

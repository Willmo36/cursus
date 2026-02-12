// ABOUTME: React hook for consuming a global workflow registered in WorkflowRegistryProvider.
// ABOUTME: Returns the same shape as useWorkflow for a consistent API.

import { useCallback, useEffect, useState } from "react";
import { useWorkflowRegistry } from "./registry-provider";
import type { WorkflowState } from "./types";

type UseGlobalWorkflowResult<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
> = {
	state: WorkflowState;
	result: T | undefined;
	error: string | undefined;
	waitingFor: (keyof SignalMap & string) | undefined;
	signal: <K extends keyof SignalMap & string>(
		name: K,
		payload: SignalMap[K],
	) => void;
	reset: () => void;
};

export function useGlobalWorkflow<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
>(workflowId: string): UseGlobalWorkflowResult<T, SignalMap> {
	const registry = useWorkflowRegistry();
	const [state, setState] = useState<WorkflowState>("running");
	const [result, setResult] = useState<T | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [waitingFor, setWaitingFor] = useState<string | undefined>(undefined);

	useEffect(() => {
		let cancelled = false;

		function syncState() {
			if (cancelled) return;
			const interpreter = registry.getInterpreter(workflowId);
			if (!interpreter) return;
			setState(interpreter.state);
			setResult(interpreter.result as T | undefined);
			setError(interpreter.error);
			setWaitingFor(interpreter.waitingFor);
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
		[workflowId, registry],
	);

	const reset = useCallback(() => {
		// TODO: implement reset for global workflows if needed
	}, []);

	return {
		state,
		result,
		error,
		waitingFor: waitingFor as (keyof SignalMap & string) | undefined,
		signal: signal as UseGlobalWorkflowResult<T, SignalMap>["signal"],
		reset,
	};
}

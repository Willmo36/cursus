// ABOUTME: React hook that runs a durable workflow and provides reactive state.
// ABOUTME: Wraps the interpreter, manages storage sync, and exposes signal/reset controls.

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction, WorkflowState, WorkflowStorage } from "./types";

type UseWorkflowOptions = {
	storage?: WorkflowStorage;
};

type UseWorkflowResult<
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

export function useWorkflow<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
>(
	workflowId: string,
	workflowFn: WorkflowFunction<T, SignalMap>,
	options?: UseWorkflowOptions,
): UseWorkflowResult<T, SignalMap> {
	const storage = options?.storage ?? new MemoryStorage();
	const [state, setState] = useState<WorkflowState>("running");
	const [result, setResult] = useState<T | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [waitingFor, setWaitingFor] = useState<string | undefined>(undefined);
	const [runId, restart] = useReducer((x: number) => x + 1, 0);
	const interpreterRef = useRef<Interpreter | null>(null);
	const storageRef = useRef(storage);

	// biome-ignore lint/correctness/useExhaustiveDependencies: runId triggers re-run on reset
	useEffect(() => {
		let cancelled = false;

		async function start() {
			const events = await storageRef.current.load(workflowId);
			const log = new EventLog(events);
			let persistedCount = events.length;

			const interpreter = new Interpreter(
				workflowFn as WorkflowFunction<unknown>,
				log,
			);
			interpreterRef.current = interpreter;

			async function persistEvents() {
				const allEvents = log.events();
				const newEvents = allEvents.slice(persistedCount);
				if (newEvents.length > 0) {
					await storageRef.current.append(workflowId, newEvents);
					persistedCount = allEvents.length;
				}
			}

			function syncState() {
				if (cancelled) return;
				setState(interpreter.state);
				setResult(interpreter.result as T | undefined);
				setError(interpreter.error);
				setWaitingFor(interpreter.waitingFor);
				persistEvents();
			}

			interpreter.onStateChange(syncState);

			await interpreter.run();

			if (cancelled) return;

			// Final state sync after run completes
			syncState();
		}

		start();

		return () => {
			cancelled = true;
		};
	}, [workflowId, workflowFn, runId]);

	const signal = useCallback((name: string, payload?: unknown) => {
		interpreterRef.current?.signal(name, payload);
	}, []);

	const reset = useCallback(() => {
		storageRef.current.clear(workflowId);
		interpreterRef.current = null;
		setState("running");
		setResult(undefined);
		setError(undefined);
		setWaitingFor(undefined);
		restart();
	}, [workflowId]);

	return {
		state,
		result,
		error,
		waitingFor: waitingFor as (keyof SignalMap & string) | undefined,
		signal: signal as UseWorkflowResult<T, SignalMap>["signal"],
		reset,
	};
}

// ABOUTME: React hook that runs a durable workflow and provides reactive state.
// ABOUTME: Wraps the interpreter, manages storage sync, and exposes signal/reset controls.

import { useCallback, useEffect, useRef, useState } from "react";
import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction, WorkflowState, WorkflowStorage } from "./types";

type UseWorkflowOptions = {
	storage?: WorkflowStorage;
};

type UseWorkflowResult<T> = {
	state: WorkflowState;
	result: T | undefined;
	error: string | undefined;
	waitingFor: string | undefined;
	signal: (name: string, payload?: unknown) => void;
	reset: () => void;
};

export function useWorkflow<T>(
	workflowId: string,
	workflowFn: WorkflowFunction<T>,
	options?: UseWorkflowOptions,
): UseWorkflowResult<T> {
	const storage = options?.storage ?? new MemoryStorage();
	const [state, setState] = useState<WorkflowState>("running");
	const [result, setResult] = useState<T | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [waitingFor, setWaitingFor] = useState<string | undefined>(undefined);
	const [version, setVersion] = useState(0);
	const interpreterRef = useRef<Interpreter | null>(null);
	const storageRef = useRef(storage);

	useEffect(() => {
		let cancelled = false;

		async function start() {
			const events = await storageRef.current.load(workflowId);
			const log = new EventLog(events);

			const interpreter = new Interpreter(
				workflowFn as WorkflowFunction<unknown>,
				log,
			);
			interpreterRef.current = interpreter;

			function syncState() {
				if (cancelled) return;
				setState(interpreter.state);
				setResult(interpreter.result as T | undefined);
				setError(interpreter.error);
				setWaitingFor(interpreter.waitingFor);
			}

			interpreter.onStateChange(syncState);

			await interpreter.run();

			if (cancelled) return;

			// Final state sync after run completes
			syncState();

			// Persist events to storage
			const newEvents = log.events().slice(events.length);
			if (newEvents.length > 0) {
				await storageRef.current.append(workflowId, newEvents);
			}
		}

		start();

		return () => {
			cancelled = true;
		};
	}, [workflowId, workflowFn, version]);

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
		setVersion((v) => v + 1);
	}, [workflowId]);

	return { state, result, error, waitingFor, signal, reset };
}

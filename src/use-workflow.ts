// ABOUTME: React hook that runs a durable workflow and provides reactive state.
// ABOUTME: Supports both inline workflows and layer-provided workflows.

import {
	useCallback,
	useContext,
	useEffect,
	useReducer,
	useRef,
	useState,
} from "react";
import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import { RegistryContext } from "./registry-provider";
import type { WorkflowSnapshot } from "./run-workflow";
import { checkVersion, MemoryStorage } from "./storage";
import type {
	AnyWorkflowFunction,
	WorkflowEvent,
	WorkflowEventObserver,
	WorkflowState,
	WorkflowStorage,
} from "./types";

type UseWorkflowOptions = {
	storage?: WorkflowStorage;
	onEvent?: WorkflowEventObserver | WorkflowEventObserver[];
	version?: number;
	snapshot?: WorkflowSnapshot;
};

type UseWorkflowResult<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
> = {
	state: WorkflowState;
	result: T | undefined;
	error: string | undefined;
	receiving: (keyof SignalMap & string) | undefined;
	receivingAll: string[] | undefined;
	receivingAny: string[] | undefined;
	published: unknown;
	signal: <K extends keyof SignalMap & string>(
		name: K,
		payload: SignalMap[K],
	) => void;
	cancel: () => void;
	reset: () => void;
};

// Overload 1: consume a workflow from the layer by ID
export function useWorkflow<T = unknown>(
	workflowId: string,
): UseWorkflowResult<T, Record<string, unknown>>;

// Overload 2: run an inline workflow with optional layer deps
export function useWorkflow<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
>(
	workflowId: string,
	workflowFn: AnyWorkflowFunction,
	options?: UseWorkflowOptions,
): UseWorkflowResult<T, SignalMap>;

// Implementation
export function useWorkflow(
	workflowId: string,
	workflowFn?: AnyWorkflowFunction,
	options?: UseWorkflowOptions,
): UseWorkflowResult<unknown, Record<string, unknown>> {
	const registry = useContext(RegistryContext);
	const isLayerMode = workflowFn === undefined;

	// For inline workflows: explicit storage > registry storage > ephemeral fallback
	const storage = options?.storage ?? registry?.storage ?? new MemoryStorage();
	const snapshot = options?.snapshot;
	const [state, setState] = useState<WorkflowState>(
		snapshot?.state ?? "running",
	);
	const [result, setResult] = useState<unknown>(snapshot?.result);
	const [error, setError] = useState<string | undefined>(snapshot?.error);
	const [receiving, setReceiving] = useState<string | undefined>(
		snapshot?.receiving,
	);
	const [receivingAll, setReceivingAll] = useState<string[] | undefined>(
		snapshot?.receivingAll,
	);
	const [receivingAny, setReceivingAny] = useState<string[] | undefined>(
		snapshot?.receivingAny,
	);
	const [published, setPublished] = useState<unknown>(snapshot?.published);
	const [runId, restart] = useReducer((x: number) => x + 1, 0);
	const interpreterRef = useRef<Interpreter | null>(null);
	const storageRef = useRef(storage);

	// biome-ignore lint/correctness/useExhaustiveDependencies: runId triggers re-run on reset
	useEffect(() => {
		if (isLayerMode) {
			// Layer mode: delegate to registry
			if (!registry) {
				throw new Error(
					"useWorkflow without a workflow function requires a WorkflowLayerProvider",
				);
			}

			let cancelled = false;

			function syncState() {
				if (cancelled) return;
				const interpreter = registry?.getInterpreter(workflowId);
				if (!interpreter) return;
				setState(interpreter.state);
				setResult(interpreter.result);
				setError(interpreter.error);
				setReceiving(interpreter.receiving);
				setReceivingAll(interpreter.receivingAll);
				setReceivingAny(interpreter.receivingAny);
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
		}

		// Inline mode: run the workflow directly
		let cancelled = false;
		let unsubscribe: (() => void) | undefined;

		async function start() {
			// Terminal snapshots: no interpreter needed, just seed storage
			if (
				snapshot &&
				(snapshot.state === "completed" || snapshot.state === "failed")
			) {
				const stored = await storageRef.current.load(workflowId);
				if (stored.length === 0) {
					await storageRef.current.append(workflowId, snapshot.events);
				}
				return;
			}

			// Seed snapshot events into storage before loading
			if (snapshot && snapshot.events.length > 0) {
				const stored = await storageRef.current.load(workflowId);
				if (stored.length === 0) {
					await storageRef.current.append(workflowId, snapshot.events);
				}
			}

			await checkVersion(storageRef.current, workflowId, options?.version);
			const events = await storageRef.current.load(workflowId);
			const observers: WorkflowEventObserver[] = options?.onEvent
				? Array.isArray(options.onEvent)
					? options.onEvent
					: [options.onEvent]
				: [];
			const onAppend =
				observers.length > 0
					? (event: WorkflowEvent) => {
							for (const obs of observers) {
								obs(workflowId, event);
							}
						}
					: undefined;
			const log = new EventLog(events, onAppend);
			let persistedCount = events.length;

			const interpreter = new Interpreter(
				workflowFn as AnyWorkflowFunction,
				log,
				registry ?? undefined,
				undefined,
				observers,
			);
			interpreterRef.current = interpreter;
			registry?.observe(workflowId, interpreter);

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
				setResult(interpreter.result);
				setError(interpreter.error);
				setReceiving(interpreter.receiving);
				setReceivingAll(interpreter.receivingAll);
				setReceivingAny(interpreter.receivingAny);
				setPublished(interpreter.published);
				persistEvents();
			}

			unsubscribe = interpreter.onStateChange(syncState);

			await interpreter.run();

			if (cancelled) return;

			// Final state sync after run completes
			syncState();

			// Compact storage for terminal workflows
			if (interpreter.state === "completed" || interpreter.state === "failed") {
				const allEvents = log.events();
				const terminalEvent = allEvents
					.slice()
					.reverse()
					.find(
						(e) =>
							e.type === "workflow_completed" || e.type === "workflow_failed",
					);
				if (terminalEvent) {
					await storageRef.current.compact(workflowId, [terminalEvent]);
				}
			}
		}

		start();

		return () => {
			unsubscribe?.();
			interpreterRef.current?.cancel();
			cancelled = true;
			registry?.unobserve(workflowId);
		};
	}, [workflowId, workflowFn, runId]);

	const signal = useCallback(
		(name: string, payload?: unknown) => {
			if (isLayerMode && registry) {
				registry.signal(workflowId, name, payload);
			} else {
				interpreterRef.current?.signal(name, payload);
			}
		},
		[isLayerMode, registry, workflowId],
	);

	const cancel = useCallback(() => {
		interpreterRef.current?.cancel();
	}, []);

	const reset = useCallback(async () => {
		if (isLayerMode && registry) {
			await registry.reset(workflowId);
			setState("running");
			setResult(undefined);
			setError(undefined);
			setReceiving(undefined);
			setReceivingAll(undefined);
			setReceivingAny(undefined);
			setPublished(undefined);
			await registry.start(workflowId);
			return;
		}
		interpreterRef.current?.cancel();
		storageRef.current.clear(workflowId);
		interpreterRef.current = null;
		setState("running");
		setResult(undefined);
		setError(undefined);
		setReceiving(undefined);
		setReceivingAll(undefined);
		setReceivingAny(undefined);
		setPublished(undefined);
		restart();
	}, [isLayerMode, registry, workflowId]);

	return {
		state,
		result,
		error,
		receiving,
		receivingAll,
		receivingAny,
		published,
		signal,
		cancel,
		reset,
	};
}

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
import type { Registry, RegistryEntry } from "./registry-builder";
import { RegistryContext } from "./registry-provider";
import type { WorkflowSnapshot } from "./run-workflow";
import { checkVersion, MemoryStorage } from "./storage";
import type {
	AnyWorkflowFunction,
	SignalMapOf,
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
	state: WorkflowState<T>;
	published: unknown;
	signal: <K extends keyof SignalMap & string>(
		name: K,
		payload: SignalMap[K],
	) => void;
	cancel: () => void;
	reset: () => void;
};

// Overload 1: consume a workflow from the layer by ID (untyped, legacy)
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

// Overload 3: run an inline workflow with optional layer deps
// biome-ignore lint/suspicious/noExplicitAny: type-erased to infer T and signal map from the workflow function
export function useWorkflow<F extends (...args: any[]) => Generator<any, any, unknown>>(
	workflowId: string,
	workflowFn: F,
	options?: UseWorkflowOptions,
): UseWorkflowResult<ReturnType<F> extends Generator<any, infer T, any> ? T : unknown, SignalMapOf<F>>;

// Implementation
export function useWorkflow(
	workflowId: string,
	workflowFnOrRegistry?: AnyWorkflowFunction | Registry<any>,
	options?: UseWorkflowOptions,
): UseWorkflowResult<unknown, Record<string, unknown>> {
	const contextRegistry = useContext(RegistryContext);

	// Detect which mode we're in
	const isRegistryMode = workflowFnOrRegistry != null && typeof workflowFnOrRegistry === "object" && "_registry" in workflowFnOrRegistry;
	const registry = isRegistryMode
		? (workflowFnOrRegistry as Registry<any>)._registry
		: contextRegistry;
	const workflowFn = isRegistryMode ? undefined : workflowFnOrRegistry as AnyWorkflowFunction | undefined;
	const isLayerMode = workflowFn === undefined;

	// For inline workflows: explicit storage > registry storage > ephemeral fallback
	const storage = options?.storage ?? registry?.storage ?? new MemoryStorage();
	const snapshot = options?.snapshot;
	const [state, setState] = useState<WorkflowState>(
		snapshot?.state ?? { status: "running" },
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
				(snapshot.state.status === "completed" || snapshot.state.status === "failed")
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
				setPublished(interpreter.published);
				persistEvents();
			}

			unsubscribe = interpreter.onStateChange(syncState);

			await interpreter.run();

			if (cancelled) return;

			// Final state sync after run completes
			syncState();

			// Compact storage for terminal workflows
			if (interpreter.status === "completed" || interpreter.status === "failed") {
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
	}, [workflowId, workflowFn, workflowFnOrRegistry, runId]);

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
			setState({ status: "running" });
			setPublished(undefined);
			await registry.start(workflowId);
			return;
		}
		interpreterRef.current?.cancel();
		storageRef.current.clear(workflowId);
		interpreterRef.current = null;
		setState({ status: "running" });
		setPublished(undefined);
		restart();
	}, [isLayerMode, registry, workflowId]);

	return {
		state,
		published,
		signal,
		cancel,
		reset,
	};
}

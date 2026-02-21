// ABOUTME: Test runtime for running workflows with mock activities and pre-queued signals.
// ABOUTME: Uses the real interpreter but intercepts commands for deterministic testing.

import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import type {
	AnyWorkflowFunction,
	WorkflowContext,
	WorkflowFunction,
	WorkflowRegistryInterface,
} from "./types";

type TestRuntimeOptions<
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
> = {
	activities?: Record<string, (...args: unknown[]) => unknown>;
	signals?: Array<
		{
			[K in keyof SignalMap & string]: { name: K; payload: SignalMap[K] };
		}[keyof SignalMap & string]
	>;
	workflowResults?: Record<string, unknown>;
};

export async function createTestRuntime<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
	WorkflowMap extends Record<string, unknown> = Record<string, never>,
	QueryMap extends Record<string, unknown> = Record<string, never>,
>(
	workflowFn: WorkflowFunction<T, SignalMap, WorkflowMap, QueryMap>,
	options: TestRuntimeOptions<SignalMap>,
): Promise<T> {
	const { activities = {}, signals = [], workflowResults } = options;
	const signalQueue = [...signals];

	// Build a mock registry if workflowResults are provided
	let mockRegistry: WorkflowRegistryInterface | undefined;
	if (workflowResults) {
		mockRegistry = {
			async waitFor<R>(
				workflowId: string,
				_options?: { start?: boolean; caller?: string },
			): Promise<R> {
				if (!(workflowId in workflowResults)) {
					throw new Error(
						`No mock result for workflow "${workflowId}" in workflowResults`,
					);
				}
				return workflowResults[workflowId] as R;
			},
			async start(): Promise<void> {},
		};
	}

	function wrapContext(
		ctx: WorkflowContext<
			Record<string, unknown>,
			Record<string, unknown>,
			Record<string, unknown>
		>,
	): WorkflowContext<
		Record<string, unknown>,
		Record<string, unknown>,
		Record<string, unknown>
	> {
		return {
			...ctx,
			activity: <U>(name: string, fn: (signal: AbortSignal) => Promise<U>) => {
				const mockFn = activities[name];
				if (mockFn) {
					return ctx.activity(name, async () => mockFn() as U);
				}
				return ctx.activity(name, fn);
			},
			child: <U, CS extends Record<string, unknown>>(
				name: string,
				workflow: WorkflowFunction<U, CS>,
			) => {
				const wrappedChild: WorkflowFunction<U, CS> = function* (childCtx) {
					const wrappedChildCtx = wrapContext(
						childCtx as WorkflowContext<
							Record<string, unknown>,
							Record<string, unknown>,
							Record<string, unknown>
						>,
					);
					return yield* (workflow as AnyWorkflowFunction)(wrappedChildCtx);
				};
				return ctx.child(name, wrappedChild);
			},
		};
	}

	// Wrap the workflow to intercept activity calls with mocks
	const wrappedWorkflow: AnyWorkflowFunction = function* (ctx) {
		const wrappedCtx = wrapContext(ctx);
		return yield* (workflowFn as AnyWorkflowFunction)(wrappedCtx);
	};

	const log = new EventLog();
	const interpreter = new Interpreter(wrappedWorkflow, log, mockRegistry);

	// Auto-send signals when the interpreter enters waiting state
	interpreter.onStateChange(() => {
		if (interpreter.state !== "waiting" || signalQueue.length === 0) return;

		// Single waitFor: match by name
		if (interpreter.waitingFor) {
			const idx = signalQueue.findIndex(
				(s) => s.name === interpreter.waitingFor,
			);
			if (idx !== -1) {
				const [signal] = signalQueue.splice(idx, 1);
				interpreter.signal(signal.name, signal.payload);
			}
			return;
		}

		// waitForAny: send first matching signal from queue
		const waitingAny = interpreter.waitingForAny;
		if (waitingAny) {
			const idx = signalQueue.findIndex((s) => waitingAny.includes(s.name));
			if (idx !== -1) {
				const [signal] = signalQueue.splice(idx, 1);
				interpreter.signal(signal.name, signal.payload);
			}
			return;
		}

		// waitForAll: send any matching signals from the queue
		const waitingAll = interpreter.waitingForAll;
		if (waitingAll) {
			for (const needed of waitingAll) {
				const idx = signalQueue.findIndex((s) => s.name === needed);
				if (idx !== -1) {
					const [signal] = signalQueue.splice(idx, 1);
					interpreter.signal(signal.name, signal.payload);
				}
			}
		}
	});

	await interpreter.run();

	if (interpreter.state === "failed") {
		throw new Error(interpreter.error ?? "Workflow failed");
	}

	return interpreter.result as T;
}

// ABOUTME: Test runtime for running workflows with mock activities and pre-queued signals.
// ABOUTME: Uses the real interpreter but intercepts commands for deterministic testing.

import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import type {
	AnyWorkflowFunction,
	WorkflowContext,
	WorkflowRegistryInterface,
} from "./types";

// Extracts the SignalMap from a workflow function's context parameter
type ExtractSignalMap<F> =
	F extends (ctx: WorkflowContext<infer S, any, any>) => any ? S : Record<string, unknown>;

// Extracts the return value type from a workflow function's generator
type ExtractResult<F> =
	F extends (...args: any[]) => Generator<any, infer A, any> ? A : unknown;

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
	// biome-ignore lint/suspicious/noExplicitAny: infers from any workflow function shape
	F extends (...args: any[]) => Generator<any, any, unknown>,
>(
	workflowFn: F,
	options: TestRuntimeOptions<ExtractSignalMap<F>>,
): Promise<ExtractResult<F>> {
	const { activities = {}, signals = [], workflowResults } = options;
	const signalQueue = [...signals];

	// Build a mock registry if workflowResults are provided
	let mockRegistry: WorkflowRegistryInterface | undefined;
	if (workflowResults) {
		mockRegistry = {
			async waitForPublished<R>(
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
			async waitForCompletion<R>(
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
			publish() {},
			getPublishSeq() { return 0; },
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
				workflow: AnyWorkflowFunction,
			) => {
				const wrappedChild: AnyWorkflowFunction = function* (childCtx) {
					const wrappedChildCtx = wrapContext(
						childCtx as unknown as WorkflowContext<
							Record<string, unknown>,
							Record<string, unknown>,
							Record<string, unknown>
						>,
					);
					// biome-ignore lint/suspicious/noExplicitAny: type-erased boundary for test mock wrapping
					return yield* (workflow as AnyWorkflowFunction)(
						wrappedChildCtx as any,
					);
				};
				return ctx.child(name, wrappedChild);
			},
		};
	}

	// Wrap the workflow to intercept activity calls with mocks
	const wrappedWorkflow: AnyWorkflowFunction = function* (ctx) {
		const wrappedCtx = wrapContext(ctx);
		// biome-ignore lint/suspicious/noExplicitAny: type-erased boundary for test mock wrapping
		return yield* (workflowFn as AnyWorkflowFunction)(wrappedCtx as any);
	};

	const log = new EventLog();
	const interpreter = new Interpreter(wrappedWorkflow, log, mockRegistry);

	// Auto-send signals when the interpreter enters waiting state
	interpreter.onStateChange(() => {
		if (interpreter.state !== "waiting" || signalQueue.length === 0) return;

		// Single receive: match by name
		if (interpreter.receiving) {
			const idx = signalQueue.findIndex(
				(s) => s.name === interpreter.receiving,
			);
			if (idx !== -1) {
				const [signal] = signalQueue.splice(idx, 1);
				interpreter.signal(signal.name, signal.payload);
			}
			return;
		}

		// race with signals: send first matching signal from queue
		const waitingAny = interpreter.receivingAny;
		if (waitingAny) {
			const idx = signalQueue.findIndex((s) => waitingAny.includes(s.name));
			if (idx !== -1) {
				const [signal] = signalQueue.splice(idx, 1);
				interpreter.signal(signal.name, signal.payload);
			}
			return;
		}

		// all with signals: send any matching signals from the queue
		const waitingAll = interpreter.receivingAll;
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

	return interpreter.result as ExtractResult<F>;
}

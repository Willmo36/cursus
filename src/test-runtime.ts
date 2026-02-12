// ABOUTME: Test runtime for running workflows with mock activities and pre-queued signals.
// ABOUTME: Uses the real interpreter but intercepts commands for deterministic testing.

import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import type { WorkflowContext, WorkflowFunction } from "./types";

type TestRuntimeOptions<
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
> = {
	activities?: Record<string, (...args: unknown[]) => unknown>;
	signals?: Array<
		{
			[K in keyof SignalMap & string]: { name: K; payload: SignalMap[K] };
		}[keyof SignalMap & string]
	>;
};

export async function createTestRuntime<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
>(
	workflowFn: WorkflowFunction<T, SignalMap>,
	options: TestRuntimeOptions<SignalMap>,
): Promise<T> {
	const { activities = {}, signals = [] } = options;
	const signalQueue = [...signals];

	// Wrap the workflow to intercept activity calls with mocks
	const wrappedWorkflow: WorkflowFunction<unknown> = function* (ctx) {
		const wrappedCtx: WorkflowContext = {
			activity: <U>(name: string, fn: () => Promise<U>) => {
				const mockFn = activities[name];
				if (mockFn) {
					return ctx.activity(name, async () => mockFn() as U);
				}
				return ctx.activity(name, fn);
			},
			waitFor: ctx.waitFor,
			sleep: ctx.sleep,
			parallel: ctx.parallel,
			child: ctx.child,
			waitAll: ctx.waitAll,
		};
		return yield* (workflowFn as WorkflowFunction<unknown>)(wrappedCtx);
	};

	const log = new EventLog();
	const interpreter = new Interpreter(wrappedWorkflow, log);

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

		// waitAll: send any matching signals from the queue
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

// ABOUTME: Test runtime for running workflows with mock activities and pre-queued signals.
// ABOUTME: Uses the real interpreter but intercepts commands for deterministic testing.

import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import type { Command, WorkflowContext, WorkflowFunction } from "./types";

type TestRuntimeOptions = {
	activities?: Record<string, (...args: unknown[]) => unknown>;
	signals?: Array<{ name: string; payload?: unknown }>;
};

export async function createTestRuntime<T>(
	workflowFn: WorkflowFunction<T>,
	options: TestRuntimeOptions,
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
		};
		return yield* (workflowFn as WorkflowFunction<unknown>)(wrappedCtx);
	};

	const log = new EventLog();
	const interpreter = new Interpreter(wrappedWorkflow, log);

	// Auto-send signals when the interpreter enters waiting state
	interpreter.onStateChange(() => {
		if (interpreter.state === "waiting" && signalQueue.length > 0) {
			const nextSignal = signalQueue.shift()!;
			if (interpreter.waitingFor === nextSignal.name) {
				interpreter.signal(nextSignal.name, nextSignal.payload);
			}
		}
	});

	await interpreter.run();

	if (interpreter.state === "failed") {
		throw new Error(interpreter.error ?? "Workflow failed");
	}

	return interpreter.result as T;
}

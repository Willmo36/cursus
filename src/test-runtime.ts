// ABOUTME: Test runtime for running workflows with mock activities and pre-queued signals.
// ABOUTME: Uses the real interpreter but intercepts commands for deterministic testing.

import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import type {
	AnyWorkflowFunction,
	Descriptor,
	WorkflowRegistryInterface,
} from "./types";

// Extracts the return value type from a workflow function's generator
type ExtractResult<F> =
	F extends (...args: any[]) => Generator<any, infer A, any> ? A : unknown;

type TestRuntimeOptions = {
	activities?: Record<string, (...args: unknown[]) => unknown>;
	signals?: Array<{ name: string; payload: unknown }>;
	workflowResults?: Record<string, unknown>;
};

function wrapWithMocks(
	workflowFn: AnyWorkflowFunction,
	activities: Record<string, (...args: unknown[]) => unknown>,
): AnyWorkflowFunction {
	return function* (ctx) {
		// biome-ignore lint/suspicious/noExplicitAny: type-erased boundary for test mock wrapping
		const gen = (workflowFn as AnyWorkflowFunction)(ctx as any);
		let input: unknown = undefined;
		let threw = false;
		let thrownValue: unknown = undefined;

		for (;;) {
			const next = threw ? gen.throw(thrownValue) : gen.next(input);
			threw = false;

			if (next.done) {
				return next.value;
			}

			const descriptor = next.value as Descriptor;

			// Intercept activity descriptors to substitute mocks by name
			if (descriptor.type === "activity") {
				const mockFn = activities[descriptor.name];
				if (mockFn) {
					const mockedDescriptor: Descriptor = {
						...descriptor,
						fn: async () => mockFn(),
					};
					try {
						input = yield mockedDescriptor;
					} catch (err) {
						threw = true;
						thrownValue = err;
					}
					continue;
				}
			}

			// Intercept child descriptors to wrap the child workflow with mocks too
			if (descriptor.type === "child") {
				const wrappedChild = wrapWithMocks(descriptor.workflow, activities);
				const wrappedDescriptor: Descriptor = {
					...descriptor,
					workflow: wrappedChild,
				};
				try {
					input = yield wrappedDescriptor;
				} catch (err) {
					threw = true;
					thrownValue = err;
				}
				continue;
			}

			try {
				input = yield descriptor;
			} catch (err) {
				threw = true;
				thrownValue = err;
			}
		}
	};
}

export async function createTestRuntime<
	// biome-ignore lint/suspicious/noExplicitAny: infers from any workflow function shape
	F extends (...args: any[]) => Generator<any, any, unknown>,
>(
	workflowFn: F,
	options: TestRuntimeOptions,
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

	const wrappedWorkflow = Object.keys(activities).length > 0
		? wrapWithMocks(workflowFn as AnyWorkflowFunction, activities)
		: workflowFn as AnyWorkflowFunction;

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

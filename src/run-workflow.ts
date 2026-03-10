// ABOUTME: Server-side workflow execution for SSR hydration.
// ABOUTME: Runs a workflow without React and returns a serializable snapshot.

import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import { MemoryStorage } from "./storage";
import type {
	AnyWorkflowFunction,
	WorkflowEvent,
	WorkflowState,
	WorkflowStorage,
} from "./types";

export type WorkflowSnapshot = {
	workflowId: string;
	events: WorkflowEvent[];
	state: WorkflowState;
	result: unknown;
	error: string | undefined;
	published: unknown;
	waitingFor: string | undefined;
	waitingForAll: string[] | undefined;
	waitingForAny: string[] | undefined;
};

export async function runWorkflow(
	workflowId: string,
	workflowFn: AnyWorkflowFunction,
	options?: { storage?: WorkflowStorage },
): Promise<WorkflowSnapshot> {
	const storage = options?.storage ?? new MemoryStorage();
	const events = await storage.load(workflowId);
	const log = new EventLog(events);
	const interpreter = new Interpreter(workflowFn, log);

	// Race run() against the interpreter entering a waiting state.
	// run() blocks forever on waitFor/sleep, so we detect waiting via onStateChange.
	await new Promise<void>((resolve) => {
		let resolved = false;

		const unsub = interpreter.onStateChange(() => {
			if (!resolved && interpreter.state === "waiting") {
				resolved = true;
				unsub();
				resolve();
			}
		});

		interpreter.run().then(() => {
			if (!resolved) {
				resolved = true;
				unsub();
				resolve();
			}
		});
	});

	// Persist events to storage
	const allEvents = log.events();
	if (allEvents.length > 0) {
		await storage.append(workflowId, allEvents);
	}

	return {
		workflowId,
		events: allEvents,
		state: interpreter.state,
		result: interpreter.result,
		error: interpreter.error,
		published: interpreter.published,
		waitingFor: interpreter.waitingFor,
		waitingForAll: interpreter.waitingForAll,
		waitingForAny: interpreter.waitingForAny,
	};
}

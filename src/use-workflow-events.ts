// ABOUTME: React hook that returns realtime event logs for all registered workflows.
// ABOUTME: Reads events from the interpreter's in-memory log via the registry.

import { useContext, useEffect, useReducer } from "react";
import { RegistryContext } from "./registry-provider";
import type { WorkflowEvent } from "./types";

export type WorkflowEventLog = {
	id: string;
	events: WorkflowEvent[];
};

function readLogs(registry: {
	getWorkflowIds(): string[];
	getEvents(id: string): WorkflowEvent[];
}): WorkflowEventLog[] {
	return registry
		.getWorkflowIds()
		.map((id) => ({ id, events: registry.getEvents(id) }));
}

export function useWorkflowEvents(): WorkflowEventLog[] {
	const registry = useContext(RegistryContext);
	if (!registry) {
		throw new Error(
			"useWorkflowEvents must be used within a WorkflowLayerProvider",
		);
	}
	const [, forceRender] = useReducer((x: number) => x + 1, 0);

	useEffect(() => {
		const unsubs: Array<() => void> = [];

		function subscribe() {
			// Clean up previous per-workflow subscriptions
			for (const fn of unsubs) fn();
			unsubs.length = 0;

			// Subscribe to each workflow's state changes
			for (const id of registry.getWorkflowIds()) {
				unsubs.push(registry.onStateChange(id, forceRender));
			}

			forceRender();
		}

		subscribe();

		// Re-subscribe when workflows are added/removed
		const unsubWorkflows = registry.onWorkflowsChange(subscribe);

		return () => {
			unsubWorkflows();
			for (const fn of unsubs) fn();
		};
	}, [registry]);

	return readLogs(registry);
}

// ABOUTME: React hook that returns realtime event logs for all registered workflows.
// ABOUTME: Reads events from the interpreter's in-memory log via the registry.

import { useEffect, useState } from "react";
import { useWorkflowRegistry } from "./registry-provider";
import type { WorkflowEvent } from "./types";

export type WorkflowEventLog = {
	id: string;
	events: WorkflowEvent[];
};

export function useWorkflowEvents(): WorkflowEventLog[] {
	const registry = useWorkflowRegistry();
	const [ids, setIds] = useState(() => registry.getWorkflowIds());
	const [logs, setLogs] = useState<WorkflowEventLog[]>(() =>
		ids.map((id) => ({ id, events: registry.getEvents(id) })),
	);

	useEffect(() => {
		return registry.onWorkflowsChange(() => {
			setIds(registry.getWorkflowIds());
		});
	}, [registry]);

	useEffect(() => {
		function refresh() {
			const currentIds = registry.getWorkflowIds();
			setLogs(currentIds.map((id) => ({ id, events: registry.getEvents(id) })));
		}
		refresh();
		const unsubs = ids.map((id) => registry.onStateChange(id, refresh));
		return () => {
			for (const fn of unsubs) {
				fn();
			}
		};
	}, [registry, ids]);

	return logs;
}

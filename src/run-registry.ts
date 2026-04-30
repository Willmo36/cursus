// ABOUTME: Server-side registry execution for SSR hydration.
// ABOUTME: Runs all (or selected) workflows to completion/waiting and returns per-workflow snapshots.

import type { Registry, RegistryEntry } from "./registry-builder";
import type { WorkflowEvent, WorkflowState } from "./types";

export type WorkflowSnapshot = {
	workflowId: string;
	events: WorkflowEvent[];
	state: WorkflowState;
	published: unknown;
};

export type RegistrySnapshot<Provides extends Record<string, RegistryEntry>> = {
	[K in keyof Provides & string]: WorkflowSnapshot;
};

/**
 * Runs each workflow in the registry until it settles (completes, fails, or
 * blocks on receive), then returns a per-workflow snapshot suitable for
 * client-side hydration.
 *
 * Pass an optional array of IDs to run only a subset of the registry.
 */
export async function runRegistry<Provides extends Record<string, RegistryEntry>>(
	registry: Registry<Provides>,
	ids?: Array<keyof Provides & string>,
): Promise<RegistrySnapshot<Provides>> {
	const targets = (ids ?? registry.getWorkflowIds()) as Array<keyof Provides & string>;

	await Promise.all(
		targets.map((id) =>
			new Promise<void>((resolve) => {
				let resolved = false;

				const unsub = registry.onStateChange(id, () => {
					if (resolved) return;
					const state = registry.getState(id);
					if (
						state &&
						state.status !== "running"
					) {
						resolved = true;
						unsub();
						resolve();
					}
				});

				registry.start(id).then(() => {
					if (!resolved) {
						resolved = true;
						unsub();
						resolve();
					}
				});
			}),
		),
	);

	const snapshots = {} as RegistrySnapshot<Provides>;
	for (const id of targets) {
		snapshots[id] = {
			workflowId: id,
			events: registry.getEvents(id),
			state: registry.getState(id) ?? { status: "running" },
			published: registry.getPublished(id),
		};
	}
	return snapshots;
}

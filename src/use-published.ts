// ABOUTME: React hook that selects and memoizes a slice of a workflow's published state.
// ABOUTME: Only re-renders when the selected value changes by reference.

import { useCallback, useContext, useRef, useSyncExternalStore } from "react";
import { RegistryContext } from "./registry-provider";

export function usePublished<T>(
	workflowId: string,
	selector: (published: unknown) => T,
): T | undefined {
	const registry = useContext(RegistryContext);
	if (!registry) {
		throw new Error(
			"usePublished requires a registry Provider",
		);
	}

	const cachedRef = useRef<{ value: T | undefined; seq: number }>({
		value: undefined,
		seq: -1,
	});

	const subscribe = useCallback(
		(callback: () => void) => {
			return registry.onStateChange(workflowId, callback);
		},
		[registry, workflowId],
	);

	const getSnapshot = useCallback(() => {
		const seq = registry.getPublishSeq(workflowId);
		if (seq === cachedRef.current.seq) {
			return cachedRef.current.value;
		}
		const published = registry.getPublished(workflowId);
		const selected = published === undefined ? undefined : selector(published);
		cachedRef.current = { value: selected, seq };
		return selected;
	}, [registry, workflowId, selector]);

	return useSyncExternalStore(subscribe, getSnapshot);
}

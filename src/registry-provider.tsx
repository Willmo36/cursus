// ABOUTME: React context provider that makes a WorkflowRegistry available to the component tree.
// ABOUTME: Components use useWorkflowRegistry() to access the registry instance.

import { createContext, type ReactNode, useContext, useMemo } from "react";
import { WorkflowRegistry } from "./registry";
import type { AnyWorkflowFunction, WorkflowStorage } from "./types";

export const RegistryContext = createContext<WorkflowRegistry | null>(null);

type WorkflowRegistryProviderProps = {
	workflows: Record<string, AnyWorkflowFunction>;
	storage: WorkflowStorage;
	children: ReactNode;
};

export function WorkflowRegistryProvider({
	workflows,
	storage,
	children,
}: WorkflowRegistryProviderProps) {
	const registry = useMemo(
		() => new WorkflowRegistry(workflows, storage),
		[workflows, storage],
	);
	return (
		<RegistryContext.Provider value={registry}>
			{children}
		</RegistryContext.Provider>
	);
}

export function useWorkflowRegistry(): WorkflowRegistry {
	const registry = useContext(RegistryContext);
	if (!registry) {
		throw new Error(
			"useWorkflowRegistry must be used within a WorkflowRegistryProvider",
		);
	}
	return registry;
}

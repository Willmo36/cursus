// ABOUTME: React context provider that creates a WorkflowRegistry from a layer.
// ABOUTME: Replaces WorkflowRegistryProvider with a typed layer-based API.

import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { WorkflowLayer } from "./layer";
import { WorkflowRegistry } from "./registry";
import { RegistryContext } from "./registry-provider";

type WorkflowLayerProviderProps = {
	layer: WorkflowLayer;
	children: ReactNode;
};

const LayerRegistryContext = createContext<WorkflowRegistry | null>(null);

export function WorkflowLayerProvider({
	layer,
	children,
}: WorkflowLayerProviderProps) {
	const registry = useMemo(
		() => new WorkflowRegistry(layer.workflows, layer.storage),
		[layer],
	);
	return (
		<LayerRegistryContext.Provider value={registry}>
			<RegistryContext.Provider value={registry}>
				{children}
			</RegistryContext.Provider>
		</LayerRegistryContext.Provider>
	);
}

export function useLayerRegistry(): WorkflowRegistry {
	const registry = useContext(LayerRegistryContext);
	if (!registry) {
		throw new Error(
			"useLayerRegistry must be used within a WorkflowLayerProvider",
		);
	}
	return registry;
}

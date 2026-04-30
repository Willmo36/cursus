// ABOUTME: Client-side app component that wraps ProductPage with useWorkflow.
// ABOUTME: Uses registry-based hook after hydration from the server snapshot.

import { useWorkflow } from "cursus/react";
import { ProductPage } from "./ProductPage";
import type { Product, ProductResult, ProductSignals } from "./workflow";
import type { WorkflowEvent, WorkflowState } from "cursus";

type Snapshot = {
	workflowId: string;
	events: WorkflowEvent[];
	state: WorkflowState;
	published: unknown;
};

export function App({ snapshot }: { snapshot: Snapshot }) {
	const { state, published, signal, reset } = useWorkflow("product");

	const product = (published ?? snapshot.published) as Product | undefined;

	return (
		<ProductPage
			snapshot={snapshot}
			product={product}
			state={state as WorkflowState<ProductResult>}
			onSignal={(name, payload) =>
				signal(name as keyof ProductSignals, payload)
			}
			onReset={reset}
		/>
	);
}

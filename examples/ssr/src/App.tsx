// ABOUTME: Client-side app component that wraps ProductPage with useWorkflow.
// ABOUTME: Uses registry-based hook after hydration from the server snapshot.

import type { WorkflowSnapshot, WorkflowState } from "cursus";
import { useWorkflow } from "cursus/react";
import { ProductPage } from "./ProductPage";
import type { Product, ProductResult, ProductSignals } from "./workflow";

export function App({ snapshot }: { snapshot: WorkflowSnapshot }) {
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

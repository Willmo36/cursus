// ABOUTME: Client-side app component that wraps ProductPage with useWorkflow.
// ABOUTME: Hydrates the server-rendered snapshot and adds client-side interactivity.

import type { WorkflowSnapshot } from "cursus";
import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";
import { ProductPage } from "./ProductPage";
import type { Product, ProductResult, ProductSignals } from "./workflow";
import { productWorkflow } from "./workflow";

const storage = new LocalStorage("ssr");

export function App({ snapshot }: { snapshot: WorkflowSnapshot }) {
	const { state, result, published, receiving, signal, reset } = useWorkflow<
		ProductResult,
		ProductSignals
	>("product", productWorkflow, { storage, snapshot });

	const product = (published ?? snapshot.published) as Product | undefined;

	return (
		<ProductPage
			snapshot={snapshot}
			product={product}
			state={state}
			receiving={receiving}
			result={result as ProductResult | undefined}
			onSignal={(name, payload) =>
				signal(name as keyof ProductSignals, payload)
			}
			onReset={reset}
		/>
	);
}

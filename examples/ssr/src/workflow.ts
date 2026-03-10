// ABOUTME: Product detail workflow that fetches data and optionally waits for user review.
// ABOUTME: Demonstrates a workflow suitable for SSR — the fetch completes on the server.

import type { WorkflowFunction } from "cursus";

export type Product = {
	name: string;
	price: string;
	description: string;
};

export type ProductResult = {
	product: Product;
	review: string | undefined;
};

export type ProductSignals = {
	review: string;
};

export const productWorkflow: WorkflowFunction<
	ProductResult,
	ProductSignals,
	Record<string, never>,
	Product
> =
	function* (ctx) {
		const product = yield* ctx.activity("fetch-product", async () => {
			// Simulate API call
			await new Promise((r) => setTimeout(r, 500));
			return {
				name: "Wireless Headphones",
				price: "$79.99",
				description:
					"Premium noise-cancelling headphones with 30-hour battery life.",
			};
		});

		yield* ctx.publish(product);

		const review = yield* ctx.waitFor("review");

		return { product, review };
	};

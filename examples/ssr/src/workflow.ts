// ABOUTME: Product detail workflow that fetches data and optionally waits for user review.
// ABOUTME: Demonstrates a workflow suitable for SSR — the fetch completes on the server.

import { activity, publish, query, workflow } from "cursus";

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

export const productWorkflow = workflow(function* () {
	const product = yield* activity("fetch-product", async () => {
		// Simulate API call
		await new Promise((r) => setTimeout(r, 500));
		return {
			name: "Wireless Headphones",
			price: "$79.99",
			description:
				"Premium noise-cancelling headphones with 30-hour battery life.",
		};
	});

	yield* publish(product);

	const review = yield* query("review").as<string>();

	return { product, review };
});

// ABOUTME: Product grid that loads products via a catalog workflow.
// ABOUTME: Shows loading, error with retry, and product cards with add-to-cart buttons.
import { useMemo } from "react";
import { useWorkflow } from "react-workflow";
import { useErrorToggle } from "./error-toggle";
import { storage } from "./storage";
import type { Product } from "./types";
import { createCatalogWorkflow } from "./workflows";

export function ProductList() {
	const { apiFetch } = useErrorToggle();
	const catalogWorkflow = useMemo(
		() => createCatalogWorkflow(apiFetch),
		[apiFetch],
	);
	const { state, result, error, reset } = useWorkflow(
		"catalog",
		catalogWorkflow,
		{ storage },
	);

	const cartWorkflow = useWorkflow("cart");

	if (state === "running") {
		return <p className="text-gray-500 italic">Loading products...</p>;
	}

	if (state === "failed") {
		return (
			<div className="p-4 bg-red-50 rounded-lg">
				<p className="text-red-700 mb-3">
					Failed to load products: {error}
				</p>
				<button
					type="button"
					onClick={reset}
					className="px-4 py-2 bg-red-700 text-white rounded cursor-pointer"
				>
					Retry
				</button>
			</div>
		);
	}

	if (!result) return null;

	return (
		<div>
			<h2 className="mt-0 text-xl font-bold">Products</h2>
			<div className="grid grid-cols-2 gap-4">
				{result.map((product) => (
					<ProductCard
						key={product.id}
						product={product}
						onAdd={() => cartWorkflow.signal("add", product.id)}
					/>
				))}
			</div>
		</div>
	);
}

function ProductCard({
	product,
	onAdd,
}: { product: Product; onAdd: () => void }) {
	return (
		<div className="border border-gray-300 rounded-lg p-3 flex flex-col">
			<img
				src={product.image}
				alt={product.name}
				className="w-full rounded mb-2"
			/>
			<h3 className="m-0 mb-1 text-base font-semibold">{product.name}</h3>
			<p className="text-gray-500 text-sm m-0 mb-2 flex-1">
				{product.description}
			</p>
			<div className="flex justify-between items-center">
				<span className="font-bold">${product.price.toFixed(2)}</span>
				<button
					type="button"
					onClick={onAdd}
					className="px-3 py-1.5 bg-blue-700 text-white rounded text-sm cursor-pointer"
				>
					Add to cart
				</button>
			</div>
		</div>
	);
}

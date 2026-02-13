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
	const catalogWorkflow = useMemo(() => createCatalogWorkflow(apiFetch), [apiFetch]);
	const { state, result, error, reset } = useWorkflow(
		"catalog",
		catalogWorkflow,
		{ storage },
	);

	const cartWorkflow = useWorkflow("cart");

	if (state === "running") {
		return <p style={{ color: "#666", fontStyle: "italic" }}>Loading products...</p>;
	}

	if (state === "failed") {
		return (
			<div style={{ padding: 16, background: "#ffebee", borderRadius: 8 }}>
				<p style={{ color: "#d32f2f", margin: "0 0 12px" }}>
					Failed to load products: {error}
				</p>
				<button
					type="button"
					onClick={reset}
					style={{
						padding: "8px 16px",
						background: "#d32f2f",
						color: "white",
						border: "none",
						borderRadius: 4,
						cursor: "pointer",
					}}
				>
					Retry
				</button>
			</div>
		);
	}

	if (!result) return null;

	return (
		<div>
			<h2 style={{ marginTop: 0 }}>Products</h2>
			<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
				{result.map((product) => (
					<ProductCard
						key={product.id}
						product={product}
						onAdd={() =>
							cartWorkflow.signal("action", { type: "add", productId: product.id })
						}
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
		<div
			style={{
				border: "1px solid #ddd",
				borderRadius: 8,
				padding: 12,
				display: "flex",
				flexDirection: "column",
			}}
		>
			<img
				src={product.image}
				alt={product.name}
				style={{ width: "100%", borderRadius: 4, marginBottom: 8 }}
			/>
			<h3 style={{ margin: "0 0 4px" }}>{product.name}</h3>
			<p style={{ color: "#666", fontSize: 13, margin: "0 0 8px", flex: 1 }}>
				{product.description}
			</p>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
				<span style={{ fontWeight: "bold" }}>${product.price.toFixed(2)}</span>
				<button
					type="button"
					onClick={onAdd}
					style={{
						padding: "6px 12px",
						background: "#1976D2",
						color: "white",
						border: "none",
						borderRadius: 4,
						cursor: "pointer",
						fontSize: 13,
					}}
				>
					Add to cart
				</button>
			</div>
		</div>
	);
}

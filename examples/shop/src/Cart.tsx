// ABOUTME: Cart sidebar showing current items with quantity and remove buttons.
// ABOUTME: Reads cart state from workflow events and signals checkout when ready.
import { useMemo } from "react";
import { useWorkflow, useWorkflowEvents } from "react-workflow";
import type { CartItem } from "./types";

export function Cart({ onCheckout }: { onCheckout: () => void }) {
	const { state, signal, error } = useWorkflow("cart");
	const items = useCartItems();

	if (state === "failed") {
		return (
			<div style={{ padding: 16, background: "#ffebee", borderRadius: 8 }}>
				<h2 style={{ marginTop: 0 }}>Cart</h2>
				<p style={{ color: "#d32f2f" }}>Cart error: {error}</p>
			</div>
		);
	}

	if (state === "completed") {
		return (
			<div
				style={{
					border: "1px solid #ddd",
					borderRadius: 8,
					padding: 16,
					alignSelf: "start",
				}}
			>
				<h2 style={{ marginTop: 0 }}>Cart</h2>
				<p style={{ color: "#666" }}>Checkout in progress...</p>
			</div>
		);
	}

	return (
		<div
			style={{
				border: "1px solid #ddd",
				borderRadius: 8,
				padding: 16,
				alignSelf: "start",
			}}
		>
			<h2 style={{ marginTop: 0 }}>Cart</h2>

			{items.length === 0 && (
				<p style={{ color: "#999" }}>Your cart is empty</p>
			)}

			{items.map((item) => (
				<div
					key={item.productId}
					style={{
						display: "flex",
						justifyContent: "space-between",
						alignItems: "center",
						padding: "8px 0",
						borderBottom: "1px solid #eee",
					}}
				>
					<div>
						<div style={{ fontSize: 14, fontWeight: 500 }}>{item.name}</div>
						<div style={{ fontSize: 12, color: "#666" }}>
							${item.price.toFixed(2)} x {item.quantity}
						</div>
					</div>
					<button
						type="button"
						onClick={() =>
							signal("action", { type: "remove", productId: item.productId })
						}
						style={{
							background: "none",
							border: "none",
							color: "#d32f2f",
							cursor: "pointer",
							fontSize: 13,
						}}
					>
						Remove
					</button>
				</div>
			))}

			{items.length > 0 && (
				<>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							marginTop: 12,
							fontWeight: "bold",
						}}
					>
						<span>Total</span>
						<span>
							$
							{items
								.reduce((sum, i) => sum + i.price * i.quantity, 0)
								.toFixed(2)}
						</span>
					</div>
					<button
						type="button"
						onClick={() => {
							signal("action", { type: "checkout" });
							onCheckout();
						}}
						style={{
							width: "100%",
							marginTop: 12,
							padding: "10px 0",
							background: "#388E3C",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
							fontSize: 14,
							fontWeight: 500,
						}}
					>
						Checkout
					</button>
				</>
			)}
		</div>
	);
}

function useCartItems(): CartItem[] {
	const logs = useWorkflowEvents();

	return useMemo(() => {
		const cartLog = logs.find((l) => l.id === "cart");
		if (!cartLog) return [];

		// Find the most recent activity_completed event — its result is the full cart
		for (let i = cartLog.events.length - 1; i >= 0; i--) {
			const event = cartLog.events[i];
			if (event.type === "activity_completed") {
				return event.result as CartItem[];
			}
		}
		return [];
	}, [logs]);
}

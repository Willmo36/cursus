// ABOUTME: UI for the opentelemetry example showing a traced checkout workflow.
// ABOUTME: Each workflow event creates an OTel span visible in the browser console.
import { useWorkflow } from "cursus/react";
import { storage } from "./storage";
import { tracingObserver } from "./tracing";
import type { OrderResult } from "./workflows";
import { checkoutWorkflow } from "./workflows";

export function App() {
	return (
		<div
			style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui" }}
		>
			<h1>OpenTelemetry Tracing</h1>
			<p style={{ color: "#666" }}>
				Open the browser console to see OTel spans as each workflow event fires.
			</p>
			<hr
				style={{
					margin: "24px 0",
					border: "none",
					borderTop: "1px solid #ddd",
				}}
			/>
			<Checkout />
		</div>
	);
}

function Checkout() {
	const { state, signal } = useWorkflow(
		"checkout",
		checkoutWorkflow,
		{
			storage,
			onEvent: tracingObserver,
		},
	);

	if (state.status === "failed") {
		return (
			<div style={{ background: "#ffebee", padding: 16, borderRadius: 8 }}>
				<p style={{ color: "#c62828" }}>Checkout failed: {state.error}</p>
			</div>
		);
	}

	if (state.status === "completed") {
		const order = state.result as OrderResult;
		return (
			<div style={{ background: "#e8f5e9", padding: 16, borderRadius: 8 }}>
				<h2 style={{ marginTop: 0 }}>Order Confirmed</h2>
				<p>
					<strong>Order ID:</strong> {order.orderId}
				</p>
				<p>
					<strong>Total:</strong> ${order.total.toFixed(2)}
				</p>
				<p>
					<strong>Status:</strong> {order.status}
				</p>
			</div>
		);
	}

	if (state.status === "waiting") {
		return (
			<div style={{ background: "#fff3e0", padding: 16, borderRadius: 8 }}>
				<h2 style={{ marginTop: 0 }}>Confirm Payment</h2>
				<p>Cart validated. Ready to pay $79.99.</p>
				<button
					type="button"
					onClick={() => signal("confirm", { cardLast4: "4242" })}
					style={{
						padding: "8px 20px",
						background: "#1976d2",
						color: "white",
						border: "none",
						borderRadius: 4,
						cursor: "pointer",
						fontSize: 14,
					}}
				>
					Pay with card ending 4242
				</button>
			</div>
		);
	}

	return (
		<div style={{ background: "#f5f5f5", padding: 16, borderRadius: 8 }}>
			<p style={{ color: "#666", fontStyle: "italic" }}>
				Processing checkout...
			</p>
		</div>
	);
}

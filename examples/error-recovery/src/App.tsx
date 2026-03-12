// ABOUTME: UI for the error recovery example.
// ABOUTME: Payment form feeds the layer workflow; order flow shows the caught failure.

import { WorkflowDebugPanel } from "cursus/devtools";
import { useWorkflow } from "cursus/react";
import { useState } from "react";
import { storage } from "./storage";
import { orderWorkflow } from "./workflows";

export function App() {
	return (
		<>
			<div
				style={{
					maxWidth: 520,
					margin: "40px auto",
					paddingBottom: 60,
					fontFamily: "system-ui",
				}}
			>
				<h1>Error Recovery</h1>
				<p style={{ color: "#666", marginBottom: 24 }}>
					The payment gateway always fails. The order workflow catches the
					dependency error and completes gracefully.
				</p>
				<PaymentForm />
				<hr
					style={{
						margin: "24px 0",
						border: "none",
						borderTop: "1px solid #ddd",
					}}
				/>
				<OrderFlow />
			</div>
			<WorkflowDebugPanel
				onClear={async () => {
					await storage.clear("payment");
					await storage.clear("order");
					window.location.reload();
				}}
			/>
		</>
	);
}

function PaymentForm() {
	const { state, signal } = useWorkflow<unknown>("payment");
	const [card, setCard] = useState("");

	if (state.status === "completed") {
		return (
			<div style={{ background: "#e8f5e9", padding: 16, borderRadius: 8 }}>
				<p style={{ margin: 0, color: "#2e7d32" }}>Payment processed</p>
			</div>
		);
	}

	if (state.status === "failed") {
		return (
			<div style={{ background: "#ffebee", padding: 16, borderRadius: 8 }}>
				<p style={{ margin: 0, color: "#c62828" }}>
					Payment failed: Card declined
				</p>
			</div>
		);
	}

	if (state.status === "running") {
		return <StatusMessage text="Processing payment..." />;
	}

	if (state.status === "waiting") {
		return (
			<div>
				<h2>Payment</h2>
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<input
						placeholder="Card number"
						value={card}
						onChange={(e) => setCard(e.target.value.replace(/\D/g, ""))}
						style={{
							padding: 8,
							borderRadius: 4,
							border: "1px solid #ccc",
						}}
					/>
					<button
						type="button"
						disabled={!card}
						onClick={() => signal("card", { number: card })}
						style={{
							padding: "10px 20px",
							background: "#388E3C",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
						}}
					>
						Pay $49.99
					</button>
				</div>
			</div>
		);
	}

	return null;
}

function OrderFlow() {
	const { state, signal } = useWorkflow(
		"order",
		orderWorkflow,
	);
	const [name, setName] = useState("");
	const [address, setAddress] = useState("");

	if (state.status === "running") {
		return <StatusMessage text="Starting order..." />;
	}

	if (state.status === "waiting") {
		return (
			<div>
				<h2>Shipping</h2>
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<input
						placeholder="Name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						style={{
							padding: 8,
							borderRadius: 4,
							border: "1px solid #ccc",
						}}
					/>
					<input
						placeholder="Address"
						value={address}
						onChange={(e) => setAddress(e.target.value)}
						style={{
							padding: 8,
							borderRadius: 4,
							border: "1px solid #ccc",
						}}
					/>
					<button
						type="button"
						disabled={!name || !address}
						onClick={() => signal("shipping", { name, address })}
						style={{
							padding: "10px 20px",
							background: "#1976D2",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
						}}
					>
						Continue
					</button>
				</div>
			</div>
		);
	}

	if (state.status === "completed") {
		if (state.result.status === "confirmed") {
			return (
				<div style={{ background: "#e8f5e9", padding: 16, borderRadius: 8 }}>
					<h2 style={{ margin: "0 0 8px" }}>Order Confirmed</h2>
					<p>
						<strong>Ship to:</strong> {state.result.name}, {state.result.address}
					</p>
					<p>
						<strong>Card:</strong> ****{state.result.last4}
					</p>
					<p>
						<strong>Amount:</strong> {state.result.amount}
					</p>
				</div>
			);
		}

		return (
			<div style={{ background: "#fff3e0", padding: 16, borderRadius: 8 }}>
				<h2 style={{ margin: "0 0 8px", color: "#e65100" }}>
					Order Could Not Be Completed
				</h2>
				<p>
					<strong>Shipping:</strong> {state.result.name}, {state.result.address}
				</p>
				<p style={{ color: "#c62828" }}>
					<strong>Payment error:</strong> {state.result.error}
				</p>
				<p style={{ color: "#666", fontSize: 14 }}>
					The order workflow caught the payment dependency failure and completed
					gracefully. Check the debug panel to see the{" "}
					<code>workflow_dependency_failed</code> event.
				</p>
			</div>
		);
	}

	if (state.status === "waiting") {
		return <StatusMessage text="Waiting for payment..." />;
	}

	return null;
}

function StatusMessage({ text }: { text: string }) {
	return <p style={{ color: "#666", fontStyle: "italic" }}>{text}</p>;
}

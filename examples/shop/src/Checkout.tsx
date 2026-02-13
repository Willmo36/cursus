// ABOUTME: Checkout flow with login form and order confirmation.
// ABOUTME: Sends login credentials as a signal to the checkout workflow.
import { useState } from "react";
import { useWorkflow } from "react-workflow";
import type { Order } from "./types";

export function Checkout({ onBack }: { onBack: () => void }) {
	const { state, result, error, signal, waitingForAll } =
		useWorkflow<Order>("checkout");

	const needsLogin = waitingForAll?.includes("login");

	if (state === "completed" && result) {
		return (
			<div style={{ maxWidth: 500, margin: "0 auto" }}>
				<h2>Order Confirmed</h2>
				<div
					style={{
						background: "#e8f5e9",
						padding: 16,
						borderRadius: 8,
						marginBottom: 16,
					}}
				>
					<p>
						<strong>Order ID:</strong> {result.orderId}
					</p>
					<p>
						<strong>Customer:</strong> {result.user.name} ({result.user.email})
					</p>
					<h3>Items</h3>
					{result.items.map((item) => (
						<div key={item.productId} style={{ fontSize: 14, marginBottom: 4 }}>
							{item.name} x {item.quantity} — ${(item.price * item.quantity).toFixed(2)}
						</div>
					))}
					<div
						style={{
							marginTop: 12,
							paddingTop: 8,
							borderTop: "1px solid #c8e6c9",
							fontWeight: "bold",
						}}
					>
						Total: ${result.total.toFixed(2)}
					</div>
				</div>
			</div>
		);
	}

	if (state === "failed") {
		return (
			<div style={{ maxWidth: 500, margin: "0 auto" }}>
				<h2>Checkout Failed</h2>
				<div style={{ padding: 16, background: "#ffebee", borderRadius: 8 }}>
					<p style={{ color: "#d32f2f" }}>{error}</p>
				</div>
				<button type="button" onClick={onBack} style={{ marginTop: 16 }}>
					Back to shop
				</button>
			</div>
		);
	}

	if (needsLogin) {
		return (
			<div style={{ maxWidth: 400, margin: "0 auto" }}>
				<button
					type="button"
					onClick={onBack}
					style={{
						background: "none",
						border: "none",
						cursor: "pointer",
						color: "#1976D2",
						padding: 0,
						marginBottom: 16,
					}}
				>
					&larr; Back to shop
				</button>
				<LoginForm
					onLogin={(email, password) => signal("login", { email, password })}
				/>
				<p style={{ fontSize: 12, color: "#999", marginTop: 12 }}>
					Use: user@shop.com / password123
				</p>
			</div>
		);
	}

	return (
		<div style={{ maxWidth: 500, margin: "0 auto" }}>
			<p style={{ color: "#666", fontStyle: "italic" }}>Processing order...</p>
		</div>
	);
}

function LoginForm({
	onLogin,
}: { onLogin: (email: string, password: string) => void }) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				onLogin(email, password);
			}}
		>
			<h2>Login to complete checkout</h2>
			<div style={{ marginBottom: 8 }}>
				<input
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="Email"
					required
					style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
				/>
			</div>
			<div style={{ marginBottom: 12 }}>
				<input
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Password"
					required
					style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
				/>
			</div>
			<button
				type="submit"
				style={{
					width: "100%",
					padding: "10px 0",
					background: "#1976D2",
					color: "white",
					border: "none",
					borderRadius: 4,
					cursor: "pointer",
					fontSize: 14,
				}}
			>
				Login & Place Order
			</button>
		</form>
	);
}

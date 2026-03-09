// ABOUTME: Checkout UI with a global profile workflow and a local checkout workflow.
// ABOUTME: Demonstrates cross-workflow deps: checkout blocks until profile is complete.
import { useState } from "react";
import { WorkflowDebugPanel } from "cursus/devtools";
import { useWorkflow } from "cursus/react";
import { storage } from "./storage";
import type { UserProfile } from "./workflows";
import { checkoutWorkflow } from "./workflows";

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
				<h1>Checkout</h1>
				<ProfileForm />
				<hr
					style={{
						margin: "24px 0",
						border: "none",
						borderTop: "1px solid #ddd",
					}}
				/>
				<CheckoutForm />
			</div>
			<WorkflowDebugPanel
				onClear={async () => {
					await storage.clear("profile");
					await storage.clear("checkout");
					window.location.reload();
				}}
			/>
		</>
	);
}

function ProfileForm() {
	const { state, result, waitingFor, signal, reset } =
		useWorkflow<UserProfile>("profile");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");

	if (state === "completed" && result) {
		return (
			<div style={{ background: "#e8f5e9", padding: 16, borderRadius: 8 }}>
				<p>
					<strong>Profile:</strong> {result.name} ({result.email})
				</p>
				<button type="button" onClick={reset} style={{ fontSize: 12 }}>
					Change profile
				</button>
			</div>
		);
	}

	if (state === "running") {
		return <StatusMessage text="Validating profile..." />;
	}

	if (state === "waiting" && waitingFor === "profile") {
		return (
			<div>
				<h2>Your details</h2>
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<input
						placeholder="Name"
						value={name}
						onChange={(e) => setName(e.target.value)}
						style={{ padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
					/>
					<input
						placeholder="Email"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						style={{ padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
					/>
					<button
						type="button"
						disabled={!name || !email}
						onClick={() => signal("profile", { name, email })}
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

	return null;
}

function CheckoutForm() {
	const { state, result, waitingForAll, signal } = useWorkflow(
		"checkout",
		checkoutWorkflow,
	);
	const [card, setCard] = useState("");

	if (state === "completed" && result) {
		return (
			<div style={{ background: "#e8f5e9", padding: 16, borderRadius: 8 }}>
				<h2>Order confirmed</h2>
				<p>
					<strong>Order ID:</strong> {result.orderId}
				</p>
				<p>
					<strong>Ship to:</strong> {result.name} ({result.email})
				</p>
				<p>
					<strong>Card:</strong> ****{result.cardLast4}
				</p>
			</div>
		);
	}

	if (state === "running") {
		return <StatusMessage text="Waiting for profile..." />;
	}

	if (state === "waiting" && waitingForAll?.includes("payment")) {
		return (
			<div>
				<h2>Payment</h2>
				<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
					<input
						placeholder="Card last 4 digits"
						maxLength={4}
						value={card}
						onChange={(e) => setCard(e.target.value.replace(/\D/g, ""))}
						style={{ padding: 8, borderRadius: 4, border: "1px solid #ccc" }}
					/>
					<button
						type="button"
						disabled={card.length !== 4}
						onClick={() => signal("payment", { cardLast4: card })}
						style={{
							padding: "10px 20px",
							background: "#388E3C",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
						}}
					>
						Place Order
					</button>
				</div>
			</div>
		);
	}

	return null;
}

function StatusMessage({ text }: { text: string }) {
	return <p style={{ color: "#666", fontStyle: "italic" }}>{text}</p>;
}

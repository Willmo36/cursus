// ABOUTME: Main layout for the publish example app.
// ABOUTME: Session login + checkout flow demonstrating publish and published.
import { createLayer } from "cursus";
import { WorkflowDebugPanel } from "cursus/devtools";
import { useWorkflow, WorkflowLayerProvider } from "cursus/react";
import { storage } from "./storage";
import { checkoutWorkflow, sessionWorkflow } from "./workflows";

const layer = createLayer(
	{ session: sessionWorkflow, checkout: checkoutWorkflow },
	storage,
);

function Session() {
	const { state, published, signal } = useWorkflow("session");

	if (state.status === "waiting" && !published) {
		return (
			<div>
				<h2>Login</h2>
				<button
					onClick={() => signal("login", { user: "max", password: "secret" })}
				>
					Log in as Max
				</button>
			</div>
		);
	}

	if (state.status === "running" || state.status === "waiting") {
		return (
			<div>
				<h2>Session Active</h2>
				<p>Logged in. Session workflow is still running.</p>
				<button onClick={() => signal("upgrade", { tier: "pro" })}>
					Upgrade to Pro
				</button>
				<button onClick={() => signal("revoke", undefined)}>
					Revoke Session
				</button>
			</div>
		);
	}

	return <p>Session ended.</p>;
}

function Checkout() {
	const { state, signal } = useWorkflow<string>("checkout");

	if (state.status === "completed") {
		return (
			<div>
				<h2>Checkout Complete</h2>
				<p>{state.result}</p>
			</div>
		);
	}

	if (state.status === "waiting") {
		return (
			<div>
				<h2>Checkout</h2>
				<button onClick={() => signal("pay", { amount: 99 })}>Pay $99</button>
			</div>
		);
	}

	return (
		<div>
			<h2>Checkout</h2>
			<p>Waiting for session...</p>
		</div>
	);
}

export function App() {
	return (
		<WorkflowLayerProvider layer={layer}>
			<div
				style={{
					maxWidth: 600,
					margin: "0 auto",
					padding: 20,
					fontFamily: "sans-serif",
				}}
			>
				<h1>Publish Example</h1>
				<p>
					The session workflow publishes the account on login but keeps running.
					The checkout workflow gets the published value immediately via
					ctx.published().
				</p>
				<div style={{ display: "grid", gap: 20 }}>
					<Session />
					<Checkout />
				</div>
				<div style={{ marginTop: 40 }}>
					<WorkflowDebugPanel />
				</div>
			</div>
		</WorkflowLayerProvider>
	);
}

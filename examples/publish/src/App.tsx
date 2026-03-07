// ABOUTME: Main layout for the publish example app.
// ABOUTME: Session login + checkout flow demonstrating publish and waitForWorkflow.
import {
	WorkflowDebugPanel,
	WorkflowLayerProvider,
	createLayer,
	useWorkflow,
} from "react-workflow";
import { storage } from "./storage";
import { checkoutWorkflow, sessionWorkflow } from "./workflows";

const layer = createLayer(
	{ session: sessionWorkflow, checkout: checkoutWorkflow },
	storage,
);

function Session() {
	const { state, waitingFor, signal } = useWorkflow("session");

	if (waitingFor === "login") {
		return (
			<div>
				<h2>Login</h2>
				<button
					onClick={() =>
						signal("login", { user: "max", password: "secret" })
					}
				>
					Log in as Max
				</button>
			</div>
		);
	}

	if (state === "running" || state === "waiting") {
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
	const { state, result, waitingFor, signal } = useWorkflow<string>("checkout");

	if (state === "completed") {
		return (
			<div>
				<h2>Checkout Complete</h2>
				<p>{result}</p>
			</div>
		);
	}

	if (waitingFor === "pay") {
		return (
			<div>
				<h2>Checkout</h2>
				<button onClick={() => signal("pay", { amount: 99 })}>
					Pay $99
				</button>
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
			<div style={{ maxWidth: 600, margin: "0 auto", padding: 20, fontFamily: "sans-serif" }}>
				<h1>Publish Example</h1>
				<p>
					The session workflow publishes the account on login but keeps
					running. The checkout workflow gets the published value
					immediately via waitForWorkflow.
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

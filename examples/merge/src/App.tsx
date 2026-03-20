// ABOUTME: Demo app showing two registry modules merged into one.
// ABOUTME: Auth provides "session", shop's checkout queries it after merge.
import { useState } from "react";
import { authRegistry } from "./auth";
import { shopRegistry } from "./shop";

const appRegistry = authRegistry.merge(shopRegistry).build();

export default function App() {
	const [log, setLog] = useState<string[]>([]);

	const append = (msg: string) =>
		setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

	const runDemo = async () => {
		setLog([]);
		append("Starting login...");
		await appRegistry.start("login");

		const loginState = appRegistry.getState("login");
		if (loginState?.status === "completed") {
			append(`Login complete: ${JSON.stringify(loginState.result)}`);

			// Signal the session workflow with the login result
			appRegistry.signal("session", "login", loginState.result);
			await appRegistry.start("session");
			append("Session started and published");
		}

		// Signal cart with items
		appRegistry.signal("cart", "items", ["Widget", "Gadget", "Doohickey"]);
		await appRegistry.start("cart");
		append("Cart loaded");

		// Checkout queries "session" (from auth module) and "cart" (from shop module)
		appRegistry.signal("checkout", "cart", ["Widget", "Gadget", "Doohickey"]);
		await appRegistry.start("checkout");

		const checkoutState = appRegistry.getState("checkout");
		if (checkoutState?.status === "completed") {
			append(`Checkout complete: ${JSON.stringify(checkoutState.result)}`);
		}
	};

	return (
		<div style={{ fontFamily: "monospace", padding: 24 }}>
			<h1>Registry Merge Example</h1>
			<p>
				Two modules (<code>auth</code> + <code>shop</code>) merged into one
				registry. The shop's checkout workflow queries "session" from the auth
				module.
			</p>
			<button type="button" onClick={runDemo} style={{ fontSize: 16, padding: "8px 16px" }}>
				Run Demo
			</button>
			<pre style={{ marginTop: 16, background: "#f4f4f4", padding: 16 }}>
				{log.length === 0 ? "Click 'Run Demo' to start" : log.join("\n")}
			</pre>
		</div>
	);
}

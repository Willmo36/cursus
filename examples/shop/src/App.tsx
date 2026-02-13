// ABOUTME: Main layout for the shop example.
// ABOUTME: Header with error toggle, product grid, cart sidebar, checkout flow, and debug panel.
import { useState } from "react";
import { WorkflowDebugPanel } from "react-workflow";
import { Cart } from "./Cart";
import { Checkout } from "./Checkout";
import { useErrorToggle } from "./error-toggle";
import { ProductList } from "./ProductList";

export function App() {
	const { forceError, setForceError } = useErrorToggle();
	const [showCheckout, setShowCheckout] = useState(false);

	return (
		<div style={{ fontFamily: "system-ui", maxWidth: 960, margin: "0 auto", padding: 20 }}>
			<header
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 24,
					paddingBottom: 16,
					borderBottom: "2px solid #eee",
				}}
			>
				<h1 style={{ margin: 0 }}>Shop</h1>
				<label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
					<span style={{ fontSize: 14, color: forceError ? "#d32f2f" : "#666" }}>
						Force errors
					</span>
					<input
						type="checkbox"
						checked={forceError}
						onChange={(e) => setForceError(e.target.checked)}
					/>
				</label>
			</header>

			{showCheckout ? (
				<Checkout onBack={() => setShowCheckout(false)} />
			) : (
				<div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 24 }}>
					<ProductList />
					<Cart onCheckout={() => setShowCheckout(true)} />
				</div>
			)}

			<div style={{ marginTop: 32 }}>
				<WorkflowDebugPanel />
			</div>
		</div>
	);
}

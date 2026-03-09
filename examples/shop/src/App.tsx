// ABOUTME: Main layout for the shop example.
// ABOUTME: Header with error toggle, product grid, cart sidebar, checkout flow, and debug panel.
import { useState } from "react";
import { WorkflowDebugPanel } from "cursus/devtools";
import { Cart } from "./Cart";
import { Checkout } from "./Checkout";
import { useErrorToggle } from "./error-toggle";
import { ProductList } from "./ProductList";

export function App() {
	const { forceError, setForceError } = useErrorToggle();
	const [showCheckout, setShowCheckout] = useState(false);

	return (
		<div className="max-w-4xl mx-auto p-5 font-sans">
			<header className="flex justify-between items-center mb-6 pb-4 border-b-2 border-gray-200">
				<h1 className="m-0 text-2xl font-bold">Shop</h1>
				<label className="flex items-center gap-2 cursor-pointer">
					<span
						className={`text-sm ${forceError ? "text-red-700" : "text-gray-500"}`}
					>
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
				<div className="grid grid-cols-[1fr_300px] gap-6">
					<ProductList />
					<Cart onCheckout={() => setShowCheckout(true)} />
				</div>
			)}

			<div className="mt-8">
				<WorkflowDebugPanel />
			</div>
		</div>
	);
}

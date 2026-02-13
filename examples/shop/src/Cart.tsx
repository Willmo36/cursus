// ABOUTME: Cart sidebar showing current items with quantity and remove buttons.
// ABOUTME: Reads cart state from workflow snapshot and signals checkout when ready.
import { useWorkflow } from "react-workflow";
import type { CartItem } from "./types";

export function Cart({ onCheckout }: { onCheckout: () => void }) {
	const { state, signal, error, snapshot } = useWorkflow<
		CartItem[],
		CartItem[]
	>("cart");
	const items = snapshot ?? [];

	if (state === "failed") {
		return (
			<div className="p-4 bg-red-50 rounded-lg">
				<h2 className="mt-0 text-lg font-bold">Cart</h2>
				<p className="text-red-700">Cart error: {error}</p>
			</div>
		);
	}

	if (state === "completed") {
		return (
			<div className="border border-gray-300 rounded-lg p-4 self-start">
				<h2 className="mt-0 text-lg font-bold">Cart</h2>
				<p className="text-gray-500">Checkout in progress...</p>
			</div>
		);
	}

	return (
		<div className="border border-gray-300 rounded-lg p-4 self-start">
			<h2 className="mt-0 text-lg font-bold">Cart</h2>

			{items.length === 0 && (
				<p className="text-gray-400">Your cart is empty</p>
			)}

			{items.map((item) => (
				<div
					key={item.productId}
					className="flex justify-between items-center py-2 border-b border-gray-200"
				>
					<div>
						<div className="text-sm font-medium">{item.name}</div>
						<div className="text-xs text-gray-500">
							${item.price.toFixed(2)} x {item.quantity}
						</div>
					</div>
					<button
						type="button"
						onClick={() =>
							signal("action", {
								type: "remove",
								productId: item.productId,
							})
						}
						className="bg-transparent border-none text-red-700 cursor-pointer text-sm"
					>
						Remove
					</button>
				</div>
			))}

			{items.length > 0 && (
				<>
					<div className="flex justify-between mt-3 font-bold">
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
						className="w-full mt-3 py-2.5 bg-green-700 text-white rounded cursor-pointer text-sm font-medium"
					>
						Checkout
					</button>
				</>
			)}
		</div>
	);
}

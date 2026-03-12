// ABOUTME: Checkout flow with login form and order confirmation.
// ABOUTME: Sends login credentials as a signal to the checkout workflow.

import { useWorkflow } from "cursus/react";
import { useState } from "react";
import type { Order } from "./types";

export function Checkout({ onBack }: { onBack: () => void }) {
	const { state, signal } =
		useWorkflow<Order>("checkout");

	if (state.status === "completed") {
		return (
			<div className="max-w-lg mx-auto">
				<h2 className="text-xl font-bold">Order Confirmed</h2>
				<div className="bg-green-50 p-4 rounded-lg mb-4">
					<p>
						<strong>Order ID:</strong> {state.result.orderId}
					</p>
					<p>
						<strong>Customer:</strong> {state.result.user.name} ({state.result.user.email})
					</p>
					<h3 className="font-semibold">Items</h3>
					{state.result.items.map((item) => (
						<div key={item.productId} className="text-sm mb-1">
							{item.name} x {item.quantity} — $
							{(item.price * item.quantity).toFixed(2)}
						</div>
					))}
					<div className="mt-3 pt-2 border-t border-green-200 font-bold">
						Total: ${state.result.total.toFixed(2)}
					</div>
				</div>
			</div>
		);
	}

	if (state.status === "failed") {
		return (
			<div className="max-w-lg mx-auto">
				<h2 className="text-xl font-bold">Checkout Failed</h2>
				<div className="p-4 bg-red-50 rounded-lg">
					<p className="text-red-700">{state.error}</p>
				</div>
				<button type="button" onClick={onBack} className="mt-4 cursor-pointer">
					Back to shop
				</button>
			</div>
		);
	}

	if (state.status === "waiting") {
		return (
			<div className="max-w-sm mx-auto">
				<button
					type="button"
					onClick={onBack}
					className="bg-transparent border-none cursor-pointer text-blue-700 p-0 mb-4"
				>
					&larr; Back to shop
				</button>
				<LoginForm
					onLogin={(email, password) => signal("login", { email, password })}
				/>
				<p className="text-xs text-gray-400 mt-3">
					Use: user@shop.com / password123
				</p>
			</div>
		);
	}

	return (
		<div className="max-w-lg mx-auto">
			<p className="text-gray-500 italic">Processing order...</p>
		</div>
	);
}

function LoginForm({
	onLogin,
}: {
	onLogin: (email: string, password: string) => void;
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				onLogin(email, password);
			}}
		>
			<h2 className="text-xl font-bold">Login to complete checkout</h2>
			<div className="mb-2">
				<input
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="Email"
					required
					className="w-full p-2 border border-gray-300 rounded box-border"
				/>
			</div>
			<div className="mb-3">
				<input
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="Password"
					required
					className="w-full p-2 border border-gray-300 rounded box-border"
				/>
			</div>
			<button
				type="submit"
				className="w-full py-2.5 bg-blue-700 text-white rounded cursor-pointer text-sm"
			>
				Login & Place Order
			</button>
		</form>
	);
}

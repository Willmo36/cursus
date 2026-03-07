// ABOUTME: Checkout workflow demonstrating OTel-traced activities and signals.
// ABOUTME: Simulates a multi-step checkout with validation, payment, and confirmation.
import type { WorkflowFunction } from "react-workflow";

export type OrderResult = {
	orderId: string;
	total: number;
	status: string;
};

type CheckoutSignals = {
	confirm: { cardLast4: string };
};

export const checkoutWorkflow: WorkflowFunction<OrderResult, CheckoutSignals> =
	function* (ctx) {
		// Validate the cart
		const cart = yield* ctx.activity("validate-cart", async () => {
			await new Promise((r) => setTimeout(r, 300));
			return { items: 3, total: 79.99 };
		});

		// Wait for user to confirm payment
		const { cardLast4 } = yield* ctx.waitFor("confirm");

		// Process payment
		const payment = yield* ctx.activity("charge-card", async () => {
			await new Promise((r) => setTimeout(r, 500));
			return { chargeId: `ch_${Date.now()}`, last4: cardLast4 };
		});

		// Reserve inventory
		yield* ctx.activity("reserve-inventory", async () => {
			await new Promise((r) => setTimeout(r, 200));
			return { reserved: true };
		});

		// Send confirmation email
		yield* ctx.activity("send-confirmation", async () => {
			await new Promise((r) => setTimeout(r, 150));
			return { sent: true };
		});

		return {
			orderId: payment.chargeId,
			total: cart.total,
			status: "confirmed",
		};
	};

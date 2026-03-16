// ABOUTME: Checkout workflow demonstrating OTel-traced activities and signals.
// ABOUTME: Simulates a multi-step checkout with validation, payment, and confirmation.
import { activity, query, workflow } from "cursus";

export type OrderResult = {
	orderId: string;
	total: number;
	status: string;
};

export const checkoutWorkflow = workflow(function* () {
	// Validate the cart
	const cart = yield* activity("validate-cart", async () => {
		await new Promise((r) => setTimeout(r, 300));
		return { items: 3, total: 79.99 };
	});

	// Wait for user to confirm payment
	const { cardLast4 } = yield* query("confirm").as<{ cardLast4: string }>();

	// Process payment
	const payment = yield* activity("charge-card", async () => {
		await new Promise((r) => setTimeout(r, 500));
		return { chargeId: `ch_${Date.now()}`, last4: cardLast4 };
	});

	// Reserve inventory
	yield* activity("reserve-inventory", async () => {
		await new Promise((r) => setTimeout(r, 200));
		return { reserved: true };
	});

	// Send confirmation email
	yield* activity("send-confirmation", async () => {
		await new Promise((r) => setTimeout(r, 150));
		return { sent: true };
	});

	return {
		orderId: payment.chargeId,
		total: cart.total,
		status: "confirmed",
	};
});

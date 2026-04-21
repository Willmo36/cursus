// ABOUTME: Profile and checkout workflows demonstrating cross-workflow dependencies.
// ABOUTME: The checkout workflow uses all() to wait for payment and the profile workflow.
import { activity, all, ask, receive, workflow } from "cursus";

// --- Profile workflow (registered globally) ---

export type UserProfile = {
	name: string;
	email: string;
};

export const profileWorkflow = workflow(function* () {
	const profile = yield* receive("profile").as<UserProfile>();

	yield* activity("validate-email", async () => {
		await new Promise((r) => setTimeout(r, 500));
		return profile.email.includes("@");
	});

	return profile;
});

// --- Checkout workflow (local, depends on profile) ---

type PaymentInfo = {
	cardLast4: string;
};

type OrderConfirmation = {
	orderId: string;
	name: string;
	email: string;
	cardLast4: string;
};

export const checkoutWorkflow = workflow(function* () {
	const [payment, profile] = yield* all(
		receive("payment").as<PaymentInfo>(),
		ask("profile").as<UserProfile>(),
	);

	const order = yield* activity("place-order", async () => {
		await new Promise((r) => setTimeout(r, 1000));
		return {
			orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
			name: profile.name,
			email: profile.email,
			cardLast4: payment.cardLast4,
		};
	});

	return order;
});

// ABOUTME: Profile and checkout workflows demonstrating cross-workflow dependencies.
// ABOUTME: The checkout workflow uses waitForAll to wait for the profile workflow.
import type { WorkflowFunction } from "cursus";

// --- Profile workflow (registered globally) ---

export type UserProfile = {
	name: string;
	email: string;
};

type ProfileSignals = {
	profile: UserProfile;
};

export const profileWorkflow: WorkflowFunction<UserProfile, ProfileSignals> =
	function* (ctx) {
		const profile = yield* ctx.waitFor("profile");

		yield* ctx.activity("validate-email", async () => {
			await new Promise((r) => setTimeout(r, 500));
			return profile.email.includes("@");
		});

		return profile;
	};

// --- Checkout workflow (local, depends on profile) ---

type PaymentInfo = {
	cardLast4: string;
};

type CheckoutSignals = {
	payment: PaymentInfo;
};

type CheckoutDeps = {
	profile: UserProfile;
};

type OrderConfirmation = {
	orderId: string;
	name: string;
	email: string;
	cardLast4: string;
};

export const checkoutWorkflow: WorkflowFunction<
	OrderConfirmation,
	CheckoutSignals,
	CheckoutDeps
> = function* (ctx) {
	const [payment, profile] = yield* ctx.all(
		ctx.waitFor("payment"),
		ctx.workflow("profile"),
	);

	const order = yield* ctx.activity("place-order", async () => {
		await new Promise((r) => setTimeout(r, 1000));
		return {
			orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
			name: profile.name,
			email: profile.email,
			cardLast4: payment.cardLast4,
		};
	});

	return order;
};

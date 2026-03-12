// ABOUTME: Payment and order workflows demonstrating dependency error recovery.
// ABOUTME: The payment workflow always fails; the order workflow catches the failure gracefully.
import { activity, join, receive, withRetry, workflow } from "cursus";

// --- Payment workflow (registered in layer, always fails) ---

type CardInfo = {
	number: string;
};

type Receipt = {
	last4: string;
	amount: string;
};

const charge = withRetry<Receipt>(
	async () => {
		await new Promise((r) => setTimeout(r, 800));
		throw new Error("Card declined");
	},
	{ maxAttempts: 3, initialDelayMs: 500 },
);

export const paymentWorkflow = workflow(function* () {
	const card = yield* receive("card").as<CardInfo>();
	const receipt = yield* activity("charge", charge);
	return receipt;
});

// --- Order workflow (inline, catches payment failure) ---

type ShippingInfo = {
	name: string;
	address: string;
};

export type OrderResult =
	| {
			status: "confirmed";
			name: string;
			address: string;
			last4: string;
			amount: string;
	  }
	| { status: "payment-failed"; name: string; address: string; error: string };

export const orderWorkflow = workflow(function* () {
	const shipping = yield* receive("shipping").as<ShippingInfo>();
	try {
		const receipt = yield* join("payment").as<Receipt>();
		return {
			status: "confirmed" as const,
			...shipping,
			...receipt,
		};
	} catch (e) {
		return {
			status: "payment-failed" as const,
			...shipping,
			error: e instanceof Error ? e.message : String(e),
		};
	}
});

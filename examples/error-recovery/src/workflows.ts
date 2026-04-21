// ABOUTME: Payment and order workflows demonstrating error recovery with try/catch.
// ABOUTME: The payment activity fails intermittently; the workflow retries within a loop.
import { activity, ask, loop, loopBreak, receive, sleep, workflow } from "cursus";

type CardInfo = {
	number: string;
};

type Receipt = {
	last4: string;
	amount: string;
};

export const paymentWorkflow = workflow(function* () {
	const card = yield* receive("card").as<CardInfo>();

	const receipt = yield* loop(function* () {
		try {
			const result = yield* activity("charge", async () => {
				await new Promise((r) => setTimeout(r, 800));
				if (Math.random() < 0.7) throw new Error("Card declined");
				return {
					last4: card.number.slice(-4),
					amount: "$49.99",
				} satisfies Receipt;
			});
			yield* loopBreak(result);
		} catch {
			// Wait before retrying
			yield* sleep(1000);
		}
	});

	return receipt;
});

// --- Order workflow (catches payment failure) ---

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
		const receipt = yield* ask("payment").as<Receipt>();
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

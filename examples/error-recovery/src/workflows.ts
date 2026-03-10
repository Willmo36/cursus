// ABOUTME: Payment and order workflows demonstrating dependency error recovery.
// ABOUTME: The payment workflow always fails; the order workflow catches the failure gracefully.
import { type WorkflowFunction, withRetry } from "cursus";

// --- Payment workflow (registered in layer, always fails) ---

type CardInfo = {
	number: string;
};

type PaymentSignals = {
	card: CardInfo;
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

export const paymentWorkflow: WorkflowFunction<Receipt, PaymentSignals> =
	function* (ctx) {
		const card = yield* ctx.receive("card");
		const receipt = yield* ctx.activity("charge", charge);
		return receipt;
	};

// --- Order workflow (inline, catches payment failure) ---

type ShippingInfo = {
	name: string;
	address: string;
};

type OrderSignals = {
	shipping: ShippingInfo;
};

type OrderDeps = {
	payment: Receipt;
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

export const orderWorkflow: WorkflowFunction<
	OrderResult,
	OrderSignals,
	OrderDeps
> = function* (ctx) {
	const shipping = yield* ctx.receive("shipping");
	try {
		const receipt = yield* ctx.join("payment");
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
};

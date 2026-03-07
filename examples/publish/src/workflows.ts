// ABOUTME: Session and checkout workflows demonstrating the publish pattern.
// ABOUTME: Session publishes the account on login and keeps running for revocation.
import type { WorkflowFunction } from "react-workflow";

type Account = { user: string; tier: string };

type SessionSignals = {
	login: { user: string; password: string };
	upgrade: { tier: string };
	revoke: undefined;
};

type WorkflowMap = {
	session: Account;
};

export const sessionWorkflow: WorkflowFunction<
	void,
	SessionSignals,
	Record<string, never>,
	Record<string, never>,
	Account
> = function* (ctx) {
	const { user } = yield* ctx.waitFor("login");

	const account: Account = yield* ctx.activity(
		"authenticate",
		async () => ({ user, tier: "free" }),
	);

	yield* ctx.publish(account);

	// Session stays alive — handle upgrades and revocation
	yield* ctx.on<void>({
		upgrade: function* (ctx, { tier }) {
			yield* ctx.activity("apply-upgrade", async () => {
				// In a real app, this would call an API
			});
			yield* ctx.publish({ ...account, tier });
		},
		revoke: function* (ctx) {
			yield* ctx.activity("revoke-session", async () => {
				// Clean up session server-side
			});
			yield* ctx.done(undefined);
		},
	});
};

export const checkoutWorkflow: WorkflowFunction<
	string,
	{ pay: { amount: number } },
	WorkflowMap
> = function* (ctx) {
	const account = yield* ctx.waitForWorkflow("session");

	const payment = yield* ctx.waitFor("pay");

	const confirmation = yield* ctx.activity(
		"process-payment",
		async () => `Order confirmed for ${account.user} (${account.tier}): $${payment.amount}`,
	);

	return confirmation;
};

// ABOUTME: Session and checkout workflows demonstrating the publish pattern.
// ABOUTME: Session publishes the account on login and keeps running for revocation.
import { workflow } from "cursus";
import type { WorkflowContext } from "cursus";

type Account = { user: string; tier: string };

type SessionSignals = {
	login: { user: string; password: string };
	upgrade: { tier: string };
	revoke: undefined;
};

type WorkflowMap = {
	session: Account;
};

export const sessionWorkflow = workflow(function* (
	ctx: WorkflowContext<SessionSignals, Record<string, never>, Account>,
) {
	const { user } = yield* ctx.receive("login");

	const account: Account = yield* ctx.activity("authenticate", async () => ({
		user,
		tier: "free",
	}));

	yield* ctx.publish(account);

	// Session stays alive — handle upgrades and revocation
	yield* ctx.handle<void>({
		upgrade: function* (ctx, { tier }) {
			yield* ctx.activity("apply-upgrade", async () => {
				// In a real app, this would call an API
			});
			yield* ctx.publish({ ...account, tier });
		},
		revoke: function* (ctx, _payload, done) {
			yield* ctx.activity("revoke-session", async () => {
				// Clean up session server-side
			});
			yield* done(undefined);
		},
	});
});

export const checkoutWorkflow = workflow(function* (
	ctx: WorkflowContext<{ pay: { amount: number } }, WorkflowMap>,
) {
	const account = yield* ctx.published("session");

	const payment = yield* ctx.receive("pay");

	const confirmation = yield* ctx.activity(
		"process-payment",
		async () =>
			`Order confirmed for ${account.user} (${account.tier}): $${payment.amount}`,
	);

	return confirmation;
});

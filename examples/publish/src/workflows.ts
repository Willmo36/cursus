// ABOUTME: Session and checkout workflows demonstrating the publish pattern.
// ABOUTME: Session publishes the account on login and keeps running for revocation.
import { activity, handle, publish, published, receive, workflow } from "cursus";

type Account = { user: string; tier: string };

type SessionSignals = {
	login: { user: string; password: string };
	upgrade: { tier: string };
	revoke: undefined;
};

type WorkflowMap = {
	session: Account;
};

export const sessionWorkflow = workflow(function* () {
	const { user } = yield* receive<{ user: string; password: string }, "login">("login");

	const account: Account = yield* activity("authenticate", async () => ({
		user,
		tier: "free",
	}));

	yield* publish(account);

	// Session stays alive — handle upgrades and revocation
	yield* handle<void>({
		upgrade: function* (payload) {
			const { tier } = payload as { tier: string };
			yield* activity("apply-upgrade", async () => {
				// In a real app, this would call an API
			});
			yield* publish({ ...account, tier });
		},
		revoke: function* (_payload, done) {
			yield* activity("revoke-session", async () => {
				// Clean up session server-side
			});
			yield* done(undefined);
		},
	});
});

export const checkoutWorkflow = workflow(function* () {
	const account = yield* published<Account, "session">("session");

	const payment = yield* receive<{ amount: number }, "pay">("pay");

	const confirmation = yield* activity(
		"process-payment",
		async () =>
			`Order confirmed for ${account.user} (${account.tier}): $${payment.amount}`,
	);

	return confirmation;
});

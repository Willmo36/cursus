// ABOUTME: Account and points store workflows demonstrating subscribe with takeLatest.
// ABOUTME: Points store reactively refetches whenever the account changes.
import { activity, handle, publish, receive, subscribe, workflow } from "cursus";

type Account = { id: string; name: string; tier: string };

type AccountState =
	| { status: "loading" }
	| { status: "ready"; account: Account };

type AccountSignals = {
	login: { name: string };
	upgrade: { tier: string };
};

type WorkflowMap = {
	account: AccountState;
};

export const accountWorkflow = workflow(function* () {
	yield* publish({ status: "loading" as const });

	const { name } = yield* receive<{ name: string }, "login">("login");

	const account: Account = yield* activity(
		"authenticate",
		async () => ({
			id: "user-1",
			name,
			tier: "free",
		}),
	);

	yield* publish({ status: "ready" as const, account });

	yield* handle<never>({
		upgrade: function* (payload) {
			const { tier } = payload as { tier: string };
			const updated = yield* activity(
				"apply-upgrade",
				async () => ({ ...account, tier }),
			);
			yield* publish({ status: "ready" as const, account: updated });
		},
	});
});

export const pointsWorkflow = workflow(function* () {
	yield* publish(null);

	yield* subscribe(
		"account",
		{
			where: (s): s is { status: "ready"; account: Account } =>
				(s as AccountState).status === "ready",
		},
		function* (s) {
			const { account } = s as { status: "ready"; account: Account };
			const points = yield* activity(
				"fetch-points",
				async () => account.tier === "pro" ? 500 : 100,
			);
			yield* publish(points);
		},
	);
});

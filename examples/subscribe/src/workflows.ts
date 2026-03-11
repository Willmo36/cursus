// ABOUTME: Account and points store workflows demonstrating subscribe with takeLatest.
// ABOUTME: Points store reactively refetches whenever the account changes.
import { activity, publish, receive, workflow } from "cursus";
import type { WorkflowContext } from "cursus";

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

export const accountWorkflow = workflow(function* (
	ctx: WorkflowContext<AccountSignals, Record<string, never>, AccountState>,
) {
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

	yield* ctx.handle<never>({
		upgrade: function* (ctx, { tier }) {
			const updated = yield* activity(
				"apply-upgrade",
				async () => ({ ...account, tier }),
			);
			yield* publish({ status: "ready" as const, account: updated });
		},
	});
});

export const pointsWorkflow = workflow(function* (
	ctx: WorkflowContext<Record<string, unknown>, WorkflowMap, number | null>,
) {
	yield* publish(null);

	yield* ctx.subscribe(
		"account",
		{
			where: (s): s is { status: "ready"; account: Account } =>
				s.status === "ready",
		},
		function* (ctx, { account }) {
			const points = yield* activity(
				"fetch-points",
				async () => account.tier === "pro" ? 500 : 100,
			);
			yield* publish(points);
		},
	);
});

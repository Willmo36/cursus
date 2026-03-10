// ABOUTME: Account and points store workflows demonstrating subscribe with takeLatest.
// ABOUTME: Points store reactively refetches whenever the account changes.
import type { WorkflowFunction } from "cursus";

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

export const accountWorkflow: WorkflowFunction<
	void,
	AccountSignals,
	Record<string, never>,
	AccountState
> = function* (ctx) {
	yield* ctx.publish({ status: "loading" as const });

	const { name } = yield* ctx.receive("login");

	const account: Account = yield* ctx.activity(
		"authenticate",
		async () => ({
			id: "user-1",
			name,
			tier: "free",
		}),
	);

	yield* ctx.publish({ status: "ready" as const, account });

	yield* ctx.handle<never>({
		upgrade: function* (ctx, { tier }) {
			const updated = yield* ctx.activity(
				"apply-upgrade",
				async () => ({ ...account, tier }),
			);
			yield* ctx.publish({ status: "ready" as const, account: updated });
		},
	});
};

export const pointsWorkflow: WorkflowFunction<
	void,
	Record<string, unknown>,
	WorkflowMap,
	number | null
> = function* (ctx) {
	yield* ctx.publish(null);

	yield* ctx.subscribe(
		"account",
		{
			where: (s): s is { status: "ready"; account: Account } =>
				s.status === "ready",
		},
		function* (ctx, { account }) {
			const points = yield* ctx.activity(
				"fetch-points",
				async () => account.tier === "pro" ? 500 : 100,
			);
			yield* ctx.publish(points);
		},
	);
};

// ABOUTME: Data-fetch workflow that races an API call against a timeout.
// ABOUTME: Demonstrates ctx.race to implement the timeout-an-activity pattern.
import type { WorkflowFunction } from "cursus";

export type FetchResult =
	| { status: "ok"; data: string }
	| { status: "timeout" };

async function fetchData(signal: AbortSignal): Promise<string> {
	// Simulate a slow API call (2s with some randomness)
	const delay = 1500 + Math.random() * 2000;
	return new Promise<string>((resolve, reject) => {
		const timer = setTimeout(() => resolve(`Response (${Math.round(delay)}ms)`), delay);
		signal.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}

export const fetchWorkflow: WorkflowFunction<FetchResult> = function* (ctx) {
	const result = yield* ctx.race(
		ctx.activity("fetch-data", fetchData),
		ctx.sleep(3000),
	);
	if (result.winner === 0) {
		return { status: "ok" as const, data: result.value };
	}
	return { status: "timeout" as const };
};

export type ApprovalResult =
	| { status: "approved"; by: string }
	| { status: "escalated" };

export const approvalWorkflow: WorkflowFunction<
	ApprovalResult,
	{ approve: string }
> = function* (ctx) {
	const result = yield* ctx.race(
		ctx.waitFor("approve"),
		ctx.sleep(10_000),
	);
	if (result.winner === 0) {
		return { status: "approved" as const, by: result.value };
	}
	return { status: "escalated" as const };
};

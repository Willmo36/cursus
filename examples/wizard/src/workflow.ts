// ABOUTME: Two-step signup workflow collecting email, then password, then creating an account.
// ABOUTME: Demonstrates sequential waitFor calls followed by an activity.
import type { WorkflowContext, WorkflowFunction } from "react-workflow";

type SignupResult = {
	email: string;
	token: string;
};

export const signupWorkflow: WorkflowFunction<SignupResult> = function* (
	ctx: WorkflowContext,
) {
	const email = yield* ctx.waitFor<string>("email");
	const password = yield* ctx.waitFor<string>("password");

	const token = yield* ctx.activity("create-account", async () => {
		await new Promise((r) => setTimeout(r, 1500));
		return btoa(`${email}:${password}:${Date.now()}`);
	});

	return { email, token };
};

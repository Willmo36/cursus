// ABOUTME: Two-step signup workflow collecting email and password, then creating an account.
// ABOUTME: Demonstrates all() to collect both fields in any order.
import { workflow } from "cursus";
import type { WorkflowContext } from "cursus";

type SignupSignals = {
	email: string;
	password: string;
};

type SignupResult = {
	email: string;
	token: string;
};

export const signupWorkflow = workflow(function* (
	ctx: WorkflowContext<SignupSignals>,
) {
		const [email, password] = yield* ctx.all(
			ctx.receive("email"),
			ctx.receive("password"),
		);

		const token = yield* ctx.activity("create-account", async () => {
			await new Promise((r) => setTimeout(r, 1500));
			return btoa(`${email}:${password}:${Date.now()}`);
		});

		return { email, token };
	});

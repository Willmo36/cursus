// ABOUTME: Two-step signup workflow collecting email and password, then creating an account.
// ABOUTME: Demonstrates waitForAll to collect both fields in any order.
import type { WorkflowFunction } from "react-workflow";

type SignupSignals = {
	email: string;
	password: string;
};

type SignupResult = {
	email: string;
	token: string;
};

export const signupWorkflow: WorkflowFunction<SignupResult, SignupSignals> =
	function* (ctx) {
		const [email, password] = yield* ctx.waitForAll("email", "password");

		const token = yield* ctx.activity("create-account", async () => {
			await new Promise((r) => setTimeout(r, 1500));
			return btoa(`${email}:${password}:${Date.now()}`);
		});

		return { email, token };
	};

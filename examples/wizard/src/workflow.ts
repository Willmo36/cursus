// ABOUTME: Two-step signup workflow collecting email and password, then creating an account.
// ABOUTME: Demonstrates all() to collect both fields in any order.
import { activity, all, receive, workflow } from "cursus";

type SignupResult = {
	email: string;
	token: string;
};

export const signupWorkflow = workflow(function* () {
	const [email, password] = yield* all(
		receive<string, "email">("email"),
		receive<string, "password">("password"),
	);

	const token = yield* activity("create-account", async () => {
		await new Promise((r) => setTimeout(r, 1500));
		return btoa(`${email}:${password}:${Date.now()}`);
	});

	return { email, token };
});

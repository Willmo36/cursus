// ABOUTME: Login workflow with retry loop for failed authentication attempts.
// ABOUTME: Demonstrates waitFor + activity in a loop with conditional branching.
import type { WorkflowFunction } from "react-workflow";

type Credentials = {
	username: string;
	password: string;
};

type LoginSignals = {
	credentials: Credentials;
};

type UserProfile = {
	username: string;
	displayName: string;
	loginTime: string;
};

export const loginWorkflow: WorkflowFunction<
	UserProfile,
	LoginSignals
> = function* (ctx) {
	for (;;) {
		const creds = yield* ctx.waitFor("credentials");

		const authenticated = yield* ctx.activity(
			"authenticate",
			async () => {
				await new Promise((r) => setTimeout(r, 800));
				return creds.password === "secret";
			},
		);

		if (authenticated) {
			const profile = yield* ctx.activity(
				"load-profile",
				async () => {
					await new Promise((r) => setTimeout(r, 500));
					return {
						username: creds.username,
						displayName: creds.username.charAt(0).toUpperCase() + creds.username.slice(1),
						loginTime: new Date().toLocaleTimeString(),
					};
				},
			);

			return profile;
		}
	}
};

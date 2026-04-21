// ABOUTME: Login workflow with retry loop for failed authentication attempts.
// ABOUTME: Demonstrates receive + activity in a loop with conditional branching.
import { activity, receive, workflow } from "cursus";

type Credentials = {
	username: string;
	password: string;
};

type UserProfile = {
	username: string;
	displayName: string;
	loginTime: string;
};

export const loginWorkflow = workflow(function* () {
	for (;;) {
		const creds = yield* receive("credentials").as<Credentials>();

		const authenticated = yield* activity("authenticate", async () => {
			await new Promise((r) => setTimeout(r, 800));
			return creds.password === "secret";
		});

		if (authenticated) {
			const profile = yield* activity("load-profile", async () => {
				await new Promise((r) => setTimeout(r, 500));
				return {
					username: creds.username,
					displayName:
						creds.username.charAt(0).toUpperCase() + creds.username.slice(1),
					loginTime: new Date().toLocaleTimeString(),
				};
			});

			return profile;
		}
	}
});

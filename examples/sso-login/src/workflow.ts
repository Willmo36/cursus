// ABOUTME: SSO OAuth flow workflow: initiate, wait for callback, exchange token.
// ABOUTME: Demonstrates the activity-receive-activity pattern.
import { activity, receive, workflow } from "cursus";

type SsoSession = {
	provider: string;
	email: string;
	accessToken: string;
};

export const ssoWorkflow = workflow(function* () {
	const _authUrl = yield* activity("initiate-sso", async () => {
		await new Promise((r) => setTimeout(r, 1000));
		return "https://provider.example.com/authorize?client_id=demo&state=abc123";
	});

	const callbackCode = yield* receive("sso-callback").as<string>();

	const session = yield* activity("exchange-token", async () => {
		await new Promise((r) => setTimeout(r, 1200));
		return {
			provider: "ExampleSSO",
			email: "user@example.com",
			accessToken: btoa(`${callbackCode}:${Date.now()}`),
		};
	});

	return session;
});

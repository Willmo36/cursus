// ABOUTME: SSO OAuth flow workflow: initiate, wait for callback, exchange token.
// ABOUTME: Demonstrates the activity-waitFor-activity pattern.
import { workflow } from "cursus";
import type { WorkflowContext } from "cursus";

type SsoSignals = {
	"sso-callback": string;
};

type SsoSession = {
	provider: string;
	email: string;
	accessToken: string;
};

export const ssoWorkflow = workflow(function* (
	ctx: WorkflowContext<SsoSignals>,
) {
	const _authUrl = yield* ctx.activity("initiate-sso", async () => {
		await new Promise((r) => setTimeout(r, 1000));
		return "https://provider.example.com/authorize?client_id=demo&state=abc123";
	});

	const callbackCode = yield* ctx.receive("sso-callback");

	const session = yield* ctx.activity("exchange-token", async () => {
		await new Promise((r) => setTimeout(r, 1200));
		return {
			provider: "ExampleSSO",
			email: "user@example.com",
			accessToken: btoa(`${callbackCode}:${Date.now()}`),
		};
	});

	return session;
});

// ABOUTME: Environment and user profile workflows demonstrating infrastructure dependencies.
// ABOUTME: The env workflow parses config; the user workflow consumes it via join.
import type { WorkflowFunction } from "cursus";

// --- Types ---

declare global {
	interface Window {
		__ENV__?: { API_BASE_URL: string };
	}
}

export type EnvConfig = {
	baseUrl: string;
};

export type UserProfile = {
	id: string;
	name: string;
	email: string;
};

// --- Env workflow (registered in layer, completes immediately) ---

type EnvSignals = Record<string, never>;

export const envWorkflow: WorkflowFunction<EnvConfig, EnvSignals> = function* (
	ctx,
) {
	const config = yield* ctx.activity("parse-env", async () => {
		const env = window.__ENV__ ?? { API_BASE_URL: "/api" };
		return { baseUrl: env.API_BASE_URL };
	});

	return config;
};

// --- User workflow (local, depends on env) ---

type UserSignals = Record<string, never>;

type UserDeps = {
	env: EnvConfig;
};

export const userWorkflow: WorkflowFunction<
	UserProfile,
	UserSignals,
	UserDeps
> = function* (ctx) {
	const env = yield* ctx.join("env");

	const user = yield* ctx.activity("fetch-user", async () => {
		const url = `${env.baseUrl}/user`;
		// Simulated fetch to the resolved URL
		await new Promise((r) => setTimeout(r, 500));
		console.log("Fetching user from", url);
		return {
			id: "usr_42",
			name: "Jane Doe",
			email: "jane@example.com",
		};
	});

	return user;
};

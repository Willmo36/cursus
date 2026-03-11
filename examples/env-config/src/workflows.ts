// ABOUTME: Environment and user profile workflows demonstrating infrastructure dependencies.
// ABOUTME: The env workflow parses config; the user workflow consumes it via join.
import { activity, join, workflow } from "cursus";

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

export const envWorkflow = workflow(function* () {
	const config = yield* activity("parse-env", async () => {
		const env = window.__ENV__ ?? { API_BASE_URL: "/api" };
		return { baseUrl: env.API_BASE_URL };
	});

	return config;
});

// --- User workflow (local, depends on env) ---

export const userWorkflow = workflow(function* () {
	const env = yield* join<EnvConfig, "env">("env");

	const user = yield* activity("fetch-user", async () => {
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
});

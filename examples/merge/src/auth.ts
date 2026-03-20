// ABOUTME: Auth registry module with login and session workflows.
// ABOUTME: Session publishes the user profile for other modules to consume.
import { activity, createRegistry, publish, query, workflow } from "cursus";
import { MemoryStorage } from "cursus";

export type User = { name: string; email: string };

const loginWorkflow = workflow(function* () {
	const credentials = yield* query("credentials").as<{ email: string; password: string }>();

	const user = yield* activity("authenticate", async () => {
		await new Promise((r) => setTimeout(r, 500));
		return { name: "Max", email: credentials.email };
	});

	return user;
});

const sessionWorkflow = workflow(function* () {
	const user = yield* query("login").as<User>();
	yield* publish(user);
	return user;
});

export const authRegistry = createRegistry(new MemoryStorage())
	.add("login", loginWorkflow)
	.add("session", sessionWorkflow);

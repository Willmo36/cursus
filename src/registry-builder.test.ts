// ABOUTME: Tests for the typed registry builder API.
// ABOUTME: Verifies compile-time dependency checking via add() chain.

import { describe, expect, it } from "vitest";
import { createRegistry } from "./registry-builder";
import { MemoryStorage } from "./storage";
import { activity, join, publish, published, receive, workflow } from "./types";
import type { Published, Publishes, Requirements, Result, Signal } from "./types";

type AssertEqual<T, U> = [T] extends [U] ? [U] extends [T] ? true : false : false;

describe("Registry builder", () => {
	it("creates an empty registry", () => {
		const registry = createRegistry(new MemoryStorage());
		expect(registry).toBeDefined();
	});

	it("adds a workflow with no dependencies", () => {
		const profileWorkflow = workflow(function* () {
			return yield* activity("fetch", async () => ({ name: "Max" }));
		});

		const registry = createRegistry(new MemoryStorage())
			.add("profile", profileWorkflow);

		expect(registry).toBeDefined();
	});

	it("adds a workflow that depends on a previously added workflow via join", () => {
		const profileWorkflow = workflow(function* () {
			return yield* activity("fetch", async () => ({ name: "Max" }));
		});

		const checkoutWorkflow = workflow(function* () {
			const profile = yield* join("profile").as<{ name: string }>();
			return yield* activity("checkout", async () => `order for ${profile.name}`);
		});

		// This should compile — "profile" is already provided
		const registry = createRegistry(new MemoryStorage())
			.add("profile", profileWorkflow)
			.add("checkout", checkoutWorkflow);

		expect(registry).toBeDefined();
	});

	it("adds a workflow that depends on a published value", () => {
		const sessionWorkflow = workflow(function* () {
			yield* publish({ token: "abc" });
			return "done";
		});

		const dashboardWorkflow = workflow(function* () {
			const session = yield* published("session").as<{ token: string }>();
			return `dashboard: ${session.token}`;
		});

		const registry = createRegistry(new MemoryStorage())
			.add("session", sessionWorkflow)
			.add("dashboard", dashboardWorkflow);

		expect(registry).toBeDefined();
	});

	it("allows workflows with only Signal requirements (no registry deps)", () => {
		const loginWorkflow = workflow(function* () {
			const creds = yield* receive("credentials").as<{ user: string }>();
			return creds.user;
		});

		// Signal deps are satisfied by UI, not registry — should compile
		const registry = createRegistry(new MemoryStorage())
			.add("login", loginWorkflow);

		expect(registry).toBeDefined();
	});

	it("allows workflows with Publishes requirement (outbound, not a dep)", () => {
		const counterWorkflow = workflow(function* () {
			yield* publish(42);
		});

		const registry = createRegistry(new MemoryStorage())
			.add("counter", counterWorkflow);

		expect(registry).toBeDefined();
	});

	it("rejects workflow with unsatisfied Result dependency (type-level)", () => {
		const checkoutWorkflow = workflow(function* () {
			const profile = yield* join("profile").as<{ name: string }>();
			return profile.name;
		});

		// @ts-expect-error — "profile" is not provided, should fail
		createRegistry(new MemoryStorage()).add("checkout", checkoutWorkflow);
	});

	it("rejects workflow with unsatisfied Published dependency (type-level)", () => {
		const dashboardWorkflow = workflow(function* () {
			const session = yield* published("session").as<{ token: string }>();
			return session.token;
		});

		// @ts-expect-error — "session" is not provided, should fail
		createRegistry(new MemoryStorage()).add("dashboard", dashboardWorkflow);
	});

	describe("build()", () => {
		it("returns a registry that can start and complete workflows", async () => {
			const greetWorkflow = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const registry = createRegistry(new MemoryStorage())
				.add("greet", greetWorkflow)
				.build();

			await registry.start("greet");
			const state = registry.getState("greet");
			expect(state?.status).toBe("completed");
			if (state?.status === "completed") {
				expect(state.result).toBe("hello");
			}
		});

		it("resolves cross-workflow dependencies at runtime", async () => {
			const profileWorkflow = workflow(function* () {
				return yield* activity("fetch", async () => ({ name: "Max" }));
			});

			const orderWorkflow = workflow(function* () {
				const profile = yield* join("profile").as<{ name: string }>();
				return `order for ${profile.name}`;
			});

			const registry = createRegistry(new MemoryStorage())
				.add("profile", profileWorkflow)
				.add("order", orderWorkflow)
				.build();

			await registry.start("profile");
			await registry.start("order");
			const state = registry.getState("order");
			expect(state?.status).toBe("completed");
			if (state?.status === "completed") {
				expect(state.result).toBe("order for Max");
			}
		});

		it("getState() returns typed result for the workflow", async () => {
			const greetWorkflow = workflow(function* () {
				return yield* activity("greet", async () => ({ message: "hello" }));
			});

			const registry = createRegistry(new MemoryStorage())
				.add("greet", greetWorkflow)
				.build();

			await registry.start("greet");
			const state = registry.getState("greet");
			if (state?.status === "completed") {
				// Type-level: result should be { message: string }
				const _check: AssertEqual<typeof state.result, { message: string }> = true;
				void _check;
				expect(state.result.message).toBe("hello");
			} else {
				throw new Error("Expected completed");
			}
		});

		it("build() constrains start() to registered workflow IDs (type-level)", () => {
			const greetWorkflow = workflow(function* () {
				return "hello";
			});

			const registry = createRegistry(new MemoryStorage())
				.add("greet", greetWorkflow)
				.build();

			// Valid: "greet" is a registered ID
			const _validStart: (id: "greet") => Promise<void> = registry.start.bind(registry);
			void _validStart;

			// @ts-expect-error — "unknown" is not a registered workflow ID
			const _invalidStart: (id: "unknown") => Promise<void> = registry.start.bind(registry);
			void _invalidStart;
		});
	});
});

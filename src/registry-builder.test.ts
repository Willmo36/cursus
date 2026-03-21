// ABOUTME: Tests for the typed registry builder API.
// ABOUTME: Verifies compile-time dependency checking via add() chain.

import { describe, expect, it } from "vitest";
import { createRegistry } from "./registry-builder";
import { MemoryStorage } from "./storage";
import { activity, publish, query, workflow } from "./types";
import type { Publishes, Query, Requirements } from "./types";

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

	it("adds a workflow that depends on a previously added workflow via output", () => {
		const profileWorkflow = workflow(function* () {
			return yield* activity("fetch", async () => ({ name: "Max" }));
		});

		const checkoutWorkflow = workflow(function* () {
			const profile = yield* query("profile").as<{ name: string }>();
			return yield* activity("checkout", async () => `order for ${profile.name}`);
		});

		// This should compile — "profile" is already provided
		const registry = createRegistry(new MemoryStorage())
			.add("profile", profileWorkflow)
			.add("checkout", checkoutWorkflow);

		expect(registry).toBeDefined();
	});

	it("adds a workflow that depends on a published value via output", () => {
		const sessionWorkflow = workflow(function* () {
			yield* publish({ token: "abc" });
			return "done";
		});

		const dashboardWorkflow = workflow(function* () {
			const session = yield* query("session").as<{ token: string }>();
			return `dashboard: ${session.token}`;
		});

		const registry = createRegistry(new MemoryStorage())
			.add("session", sessionWorkflow)
			.add("dashboard", dashboardWorkflow);

		expect(registry).toBeDefined();
	});

	it("allows workflows with only Signal requirements (no registry deps)", () => {
		const loginWorkflow = workflow(function* () {
			const creds = yield* query("credentials").as<{ user: string }>();
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

	it("allows workflow with query dependency (can be signal or registry match)", () => {
		const checkoutWorkflow = workflow(function* () {
			const profile = yield* query("profile").as<{ name: string }>();
			return profile.name;
		});

		// Query deps are flexible — can be satisfied by registry OR signals
		const registry = createRegistry(new MemoryStorage())
			.add("checkout", checkoutWorkflow);

		expect(registry).toBeDefined();
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
				const profile = yield* query("profile").as<{ name: string }>();
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

	describe("merge()", () => {
		it("merges two disjoint registries", () => {
			const r1 = createRegistry(new MemoryStorage())
				.add("a", workflow(function* () {
					return yield* activity("fetchA", async () => "A");
				}));

			const r2 = createRegistry(new MemoryStorage())
				.add("b", workflow(function* () {
					return yield* activity("fetchB", async () => "B");
				}));

			const merged = r1.merge(r2);
			expect(merged).toBeDefined();

			const registry = merged.build();
			expect(registry.getWorkflowIds().sort()).toEqual(["a", "b"]);
		});

		it("merged registry resolves cross-registry query dependencies", async () => {
			const profileWf = workflow(function* () {
				return yield* activity("fetch", async () => ({ name: "Max" }));
			});

			const r1 = createRegistry(new MemoryStorage())
				.add("profile", profileWf);

			const orderWf = workflow(function* () {
				const profile = yield* query("profile").as<{ name: string }>();
				return `order for ${profile.name}`;
			});

			const r2 = createRegistry(new MemoryStorage())
				.add("order", orderWf);

			const registry = r1.merge(r2).build();

			await registry.start("profile");
			await registry.start("order");

			const state = registry.getState("order");
			expect(state?.status).toBe("completed");
			if (state?.status === "completed") {
				expect(state.result).toBe("order for Max");
			}
		});

		it("overlapping key uses second registry's workflow by default", async () => {
			const greetV1 = workflow(function* () {
				return "v1";
			});
			const greetV2 = workflow(function* () {
				return "v2";
			});

			const r1 = createRegistry(new MemoryStorage())
				.add("greet", greetV1);
			const r2 = createRegistry(new MemoryStorage())
				.add("greet", greetV2);

			const registry = r1.merge(r2).build();
			await registry.start("greet");

			const state = registry.getState("greet");
			expect(state?.status).toBe("completed");
			if (state?.status === "completed") {
				expect(state.result).toBe("v2");
			}
		});

		it("overlapping key uses custom merge function when provided", async () => {
			const greetV1 = workflow(function* () {
				return "v1";
			});
			const greetV2 = workflow(function* () {
				return "v2";
			});

			const r1 = createRegistry(new MemoryStorage())
				.add("greet", greetV1);
			const r2 = createRegistry(new MemoryStorage())
				.add("greet", greetV2);

			// Keep first registry's workflow
			const registry = r1.merge(r2, (a, _b) => a).build();
			await registry.start("greet");

			const state = registry.getState("greet");
			expect(state?.status).toBe("completed");
			if (state?.status === "completed") {
				expect(state.result).toBe("v1");
			}
		});

		it("merged builder supports further add() calls", () => {
			const r1 = createRegistry(new MemoryStorage())
				.add("a", workflow(function* () { return "A"; }));

			const r2 = createRegistry(new MemoryStorage())
				.add("b", workflow(function* () { return "B"; }));

			const merged = r1.merge(r2)
				.add("c", workflow(function* () { return "C"; }));

			const registry = merged.build();
			expect(registry.getWorkflowIds().sort()).toEqual(["a", "b", "c"]);
		});

		it("type-level: merged registry has union of keys", () => {
			const r1 = createRegistry(new MemoryStorage())
				.add("a", workflow(function* () { return 1; }));

			const r2 = createRegistry(new MemoryStorage())
				.add("b", workflow(function* () { return "hello"; }));

			const registry = r1.merge(r2).build();

			// Both keys are valid
			const _validA: (id: "a") => Promise<void> = registry.start.bind(registry);
			const _validB: (id: "b") => Promise<void> = registry.start.bind(registry);
			void _validA; void _validB;

			// @ts-expect-error — "unknown" is not a registered workflow ID
			const _invalid: (id: "unknown") => Promise<void> = registry.start.bind(registry);
			void _invalid;
		});

		it("type-level: merged registry preserves result types per key", async () => {
			const r1 = createRegistry(new MemoryStorage())
				.add("num", workflow(function* () { return 42; }));

			const r2 = createRegistry(new MemoryStorage())
				.add("str", workflow(function* () { return "hello"; }));

			const registry = r1.merge(r2).build();

			await registry.start("num");
			await registry.start("str");

			const numState = registry.getState("num");
			const strState = registry.getState("str");

			if (numState?.status === "completed") {
				const _check: AssertEqual<typeof numState.result, number> = true;
				void _check;
			}
			if (strState?.status === "completed") {
				const _check: AssertEqual<typeof strState.result, string> = true;
				void _check;
			}
		});

		it("type-level: rejects merge when overlapping keys have incompatible result types", () => {
			const r1 = createRegistry(new MemoryStorage())
				.add("greet", workflow(function* () { return 42; }));
			const r2 = createRegistry(new MemoryStorage())
				.add("greet", workflow(function* () { return "hello"; }));

			// @ts-expect-error — "greet" has number in r1 but string in r2
			r1.merge(r2);
		});

		it("type-level: allows merge when overlapping keys have same result type", () => {
			const r1 = createRegistry(new MemoryStorage())
				.add("greet", workflow(function* () { return "v1"; }));
			const r2 = createRegistry(new MemoryStorage())
				.add("greet", workflow(function* () { return "v2"; }));

			// Should compile — both return string
			const merged = r1.merge(r2);
			expect(merged).toBeDefined();
		});

		it("merge preserves per-registry storage", async () => {
			const storageA = new MemoryStorage();
			const storageB = new MemoryStorage();

			const r1 = createRegistry(storageA)
				.add("a", workflow(function* () {
					return yield* activity("fetchA", async () => "A");
				}));

			const r2 = createRegistry(storageB)
				.add("b", workflow(function* () {
					return yield* activity("fetchB", async () => "B");
				}));

			const registry = r1.merge(r2).build();

			await registry.start("a");
			await registry.start("b");

			// "a" should be persisted in storageA, not storageB
			const eventsA = await storageA.load("a");
			expect(eventsA.length).toBeGreaterThan(0);
			const eventsAInB = await storageB.load("a");
			expect(eventsAInB).toEqual([]);

			// "b" should be persisted in storageB, not storageA
			const eventsB = await storageB.load("b");
			expect(eventsB.length).toBeGreaterThan(0);
			const eventsBInA = await storageA.load("b");
			expect(eventsBInA).toEqual([]);
		});

		it("merge is associative: (r1.merge(r2)).merge(r3) works", () => {
			const r1 = createRegistry(new MemoryStorage())
				.add("a", workflow(function* () { return "A"; }));
			const r2 = createRegistry(new MemoryStorage())
				.add("b", workflow(function* () { return "B"; }));
			const r3 = createRegistry(new MemoryStorage())
				.add("c", workflow(function* () { return "C"; }));

			const registry = r1.merge(r2).merge(r3).build();
			expect(registry.getWorkflowIds().sort()).toEqual(["a", "b", "c"]);
		});
	});
});

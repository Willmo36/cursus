// ABOUTME: Algebraic law conformance tests for the workflow monad.
// ABOUTME: Verifies pure/return, left identity, right identity, and associativity.

import { describe, expect, it } from "vitest";
import { createTestRuntime } from "./test-runtime";
import type { Command, WorkflowFunction } from "./types";

/**
 * A "pure" workflow that returns a value without yielding any commands.
 * This is the unit/return of the monad.
 */
// biome-ignore lint/correctness/useYield: pure intentionally yields nothing — it's the monad unit
function* pure<T>(value: T): Generator<Command, T, unknown> {
	return value;
}

describe("Monad laws", () => {
	describe("Pure/return", () => {
		it("workflow that yields no commands returns value directly", async () => {
			// biome-ignore lint/correctness/useYield: testing pure return with no yields
			const workflow: WorkflowFunction<number> = function* () {
				return 42;
			};

			const result = await createTestRuntime(workflow, {});
			expect(result).toBe(42);
		});

		it("yield* pure(a) returns a", async () => {
			const workflow: WorkflowFunction<string> = function* () {
				return yield* pure("hello");
			};

			const result = await createTestRuntime(workflow, {});
			expect(result).toBe("hello");
		});
	});

	describe("Left identity: pure(a) >>= f  ≡  f(a)", () => {
		it("yield* pure(a) then f equals f(a) directly", async () => {
			function* f(
				ctx: Parameters<WorkflowFunction<string>>[0],
				x: number,
			): Generator<Command, string, unknown> {
				const result = yield* ctx.activity("double", async () => x * 2);
				return `result: ${result}`;
			}

			// Left side: pure(5) >>= f
			const left: WorkflowFunction<string> = function* (ctx) {
				const a = yield* pure(5);
				return yield* f(ctx, a);
			};

			// Right side: f(5) directly
			const right: WorkflowFunction<string> = function* (ctx) {
				return yield* f(ctx, 5);
			};

			const leftResult = await createTestRuntime(left, {
				activities: { double: () => 10 },
			});
			const rightResult = await createTestRuntime(right, {
				activities: { double: () => 10 },
			});

			expect(leftResult).toBe(rightResult);
		});
	});

	describe("Right identity: m >>= pure  ≡  m", () => {
		it("workflow piped through pure produces same result", async () => {
			// m: a workflow that does real work
			const m: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			// m >>= pure: feed m's result through pure
			const mBindPure: WorkflowFunction<string> = function* (ctx) {
				const a = yield* ctx.activity("greet", async () => "hello");
				return yield* pure(a);
			};

			const mResult = await createTestRuntime(m, {
				activities: { greet: () => "hello" },
			});
			const mBindPureResult = await createTestRuntime(mBindPure, {
				activities: { greet: () => "hello" },
			});

			expect(mResult).toBe(mBindPureResult);
		});

		it("child workflow behaves same as inline (right identity via delegation)", async () => {
			const childWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					const val = yield* ctx.receive("data");
					return `got: ${val}`;
				};

			// Via ctx.child (yield* delegation to sub-interpreter)
			const viaChild: WorkflowFunction<string, { data: string }> = function* (
				ctx,
			) {
				return yield* ctx.child("sub", childWorkflow);
			};

			// Inline (same logic, no child)
			const inline: WorkflowFunction<string, { data: string }> = function* (
				ctx,
			) {
				const val = yield* ctx.receive("data");
				return `got: ${val}`;
			};

			const childResult = await createTestRuntime(viaChild, {
				signals: [{ name: "data", payload: "test" }],
			});
			const inlineResult = await createTestRuntime(inline, {
				signals: [{ name: "data", payload: "test" }],
			});

			expect(childResult).toBe(inlineResult);
		});
	});

	describe("Associativity: (m >>= f) >>= g  ≡  m >>= (x => f(x) >>= g)", () => {
		it("extracting a sub-generator and yield*-ing produces same result as inlining", async () => {
			// Three sequential operations: fetch user, greet user, format greeting
			function* fetchUser(
				ctx: Parameters<WorkflowFunction<string>>[0],
			): Generator<Command, string, unknown> {
				return yield* ctx.activity("fetchUser", async () => "Max");
			}

			function* greetUser(
				ctx: Parameters<WorkflowFunction<string>>[0],
				name: string,
			): Generator<Command, string, unknown> {
				return yield* ctx.activity("greet", async () => `Hello, ${name}!`);
			}

			function* formatGreeting(
				ctx: Parameters<WorkflowFunction<string>>[0],
				greeting: string,
			): Generator<Command, string, unknown> {
				return yield* ctx.activity("format", async () => `[${greeting}]`);
			}

			// Left-associated: (m >>= f) >>= g
			const leftAssoc: WorkflowFunction<string> = function* (ctx) {
				const user = yield* fetchUser(ctx);
				const greeting = yield* greetUser(ctx, user);
				return yield* formatGreeting(ctx, greeting);
			};

			// Right-associated: m >>= (x => f(x) >>= g)
			// Equivalent to extracting a composed sub-generator
			function* greetAndFormat(
				ctx: Parameters<WorkflowFunction<string>>[0],
				name: string,
			): Generator<Command, string, unknown> {
				const greeting = yield* greetUser(ctx, name);
				return yield* formatGreeting(ctx, greeting);
			}

			const rightAssoc: WorkflowFunction<string> = function* (ctx) {
				const user = yield* fetchUser(ctx);
				return yield* greetAndFormat(ctx, user);
			};

			const mocks = {
				fetchUser: () => "Max",
				greet: () => "Hello, Max!",
				format: () => "[Hello, Max!]",
			};

			const leftResult = await createTestRuntime(leftAssoc, {
				activities: mocks,
			});
			const rightResult = await createTestRuntime(rightAssoc, {
				activities: mocks,
			});

			expect(leftResult).toBe(rightResult);
			expect(leftResult).toBe("[Hello, Max!]");
		});
	});
});

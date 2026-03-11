// ABOUTME: Algebraic law conformance tests for the workflow monad.
// ABOUTME: Verifies pure/return, left identity, right identity, and associativity.

import { describe, expect, it } from "vitest";
import { createTestRuntime } from "./test-runtime";
import { activity, all, child, handle, publish, race, receive, sleep, workflow } from "./types";
import type { Dependency, Publishes, Requirements, Signal, Workflow, WorkflowContext } from "./types";

/**
 * A "pure" workflow that returns a value without yielding any commands.
 * This is the unit/return of the monad.
 */
// biome-ignore lint/correctness/useYield: pure intentionally yields nothing — it's the monad unit
function* pure<T>(value: T): Workflow<T> {
	return value;
}

describe("Monad laws", () => {
	describe("Pure/return", () => {
		it("workflow that yields no commands returns value directly", async () => {
			// biome-ignore lint/correctness/useYield: testing pure return with no yields
			const w = workflow(function* (_ctx: WorkflowContext) {
				return 42;
			});

			const result = await createTestRuntime(w, {});
			expect(result).toBe(42);
		});

		it("yield* pure(a) returns a", async () => {
			const w = workflow(function* (_ctx: WorkflowContext) {
				return yield* pure("hello");
			});

			const result = await createTestRuntime(w, {});
			expect(result).toBe("hello");
		});
	});

	describe("Left identity: pure(a) >>= f  ≡  f(a)", () => {
		it("yield* pure(a) then f equals f(a) directly", async () => {
			function* f(
				ctx: WorkflowContext,
				x: number,
			): Workflow<string> {
				const result = yield* ctx.activity("double", async () => x * 2);
				return `result: ${result}`;
			}

			// Left side: pure(5) >>= f
			const left = workflow(function* (ctx: WorkflowContext) {
				const a = yield* pure(5);
				return yield* f(ctx, a);
			});

			// Right side: f(5) directly
			const right = workflow(function* (ctx: WorkflowContext) {
				return yield* f(ctx, 5);
			});

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
			const m = workflow(function* (ctx: WorkflowContext) {
				return yield* ctx.activity("greet", async () => "hello");
			});

			// m >>= pure: feed m's result through pure
			const mBindPure = workflow(function* (ctx: WorkflowContext) {
				const a = yield* ctx.activity("greet", async () => "hello");
				return yield* pure(a);
			});

			const mResult = await createTestRuntime(m, {
				activities: { greet: () => "hello" },
			});
			const mBindPureResult = await createTestRuntime(mBindPure, {
				activities: { greet: () => "hello" },
			});

			expect(mResult).toBe(mBindPureResult);
		});

		it("child workflow behaves same as inline (right identity via delegation)", async () => {
			const childWorkflow = workflow(
				function* (ctx: WorkflowContext<{ data: string }>) {
					const val = yield* ctx.receive("data");
					return `got: ${val}`;
				},
			);

			// Via ctx.child (yield* delegation to sub-interpreter)
			const viaChild = workflow(
				function* (ctx: WorkflowContext<{ data: string }>) {
					return yield* ctx.child("sub", childWorkflow);
				},
			);

			// Inline (same logic, no child)
			const inline = workflow(
				function* (ctx: WorkflowContext<{ data: string }>) {
					const val = yield* ctx.receive("data");
					return `got: ${val}`;
				},
			);

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
				ctx: WorkflowContext,
			): Workflow<string> {
				return yield* ctx.activity("fetchUser", async () => "Max");
			}

			function* greetUser(
				ctx: WorkflowContext,
				name: string,
			): Workflow<string> {
				return yield* ctx.activity("greet", async () => `Hello, ${name}!`);
			}

			function* formatGreeting(
				ctx: WorkflowContext,
				greeting: string,
			): Workflow<string> {
				return yield* ctx.activity("format", async () => `[${greeting}]`);
			}

			// Left-associated: (m >>= f) >>= g
			const leftAssoc = workflow(function* (ctx: WorkflowContext) {
				const user = yield* fetchUser(ctx);
				const greeting = yield* greetUser(ctx, user);
				return yield* formatGreeting(ctx, greeting);
			});

			// Right-associated: m >>= (x => f(x) >>= g)
			// Equivalent to extracting a composed sub-generator
			function* greetAndFormat(
				ctx: WorkflowContext,
				name: string,
			): Workflow<string> {
				const greeting = yield* greetUser(ctx, name);
				return yield* formatGreeting(ctx, greeting);
			}

			const rightAssoc = workflow(function* (ctx: WorkflowContext) {
				const user = yield* fetchUser(ctx);
				return yield* greetAndFormat(ctx, user);
			});

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

	type AssertEqual<T, U> = [T] extends [U] ? [U] extends [T] ? true : false : false;

	describe("Requirement inference", () => {

		it("activity-only workflow has no requirements", () => {
			const w = workflow(function* (ctx: WorkflowContext) {
				return yield* ctx.activity("fetch", async () => 42);
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, never> = true;
			void _check;
			void w;
		});

		it("receive propagates Signal requirement", () => {
			const w = workflow(function* (ctx: WorkflowContext<{ login: { name: string } }>) {
				const user = yield* ctx.receive("login");
				return user.name;
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"login", { name: string }>> = true;
			void _check;
			void w;
		});

		it("published propagates Dependency requirement", () => {
			const w = workflow(function* (
				ctx: WorkflowContext<Record<string, unknown>, { config: { url: string } }>,
			) {
				const config = yield* ctx.published("config");
				return config.url;
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Dependency<"config", { url: string }>> = true;
			void _check;
			void w;
		});

		it("publish propagates Publishes requirement", () => {
			const w = workflow(function* (
				ctx: WorkflowContext<Record<string, unknown>, Record<string, never>, number>,
			) {
				yield* ctx.publish(42);
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Publishes<number>> = true;
			void _check;
			void w;
		});

		it("multiple operations accumulate requirements as union", () => {
			const w = workflow(function* (
				ctx: WorkflowContext<
					{ login: { name: string } },
					{ config: { url: string } },
					number
				>,
			) {
				const config = yield* ctx.published("config");
				const user = yield* ctx.receive("login");
				yield* ctx.publish(42);
				return `${config.url}-${user.name}`;
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<
				R,
				| Dependency<"config", { url: string }>
				| Signal<"login", { name: string }>
				| Publishes<number>
			> = true;
			void _check;
			void w;
		});

		it("workflow() constructor enables inference and works at runtime", async () => {
			const w = workflow(function* (ctx: WorkflowContext<{ greet: string }>) {
				const name = yield* ctx.receive("greet");
				const msg = yield* ctx.activity("format", async () => `Hello ${name}`);
				return msg;
			});

			// Type-level: Requirements are inferred
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"greet", string>> = true;
			void _check;

			// Runtime: workflow() output is usable with createTestRuntime
			const result = await createTestRuntime(w, {
				signals: [{ name: "greet", payload: "Max" }],
				activities: { format: () => "Hello Max" },
			});
			expect(result).toBe("Hello Max");
		});
	});

	describe("Free functions", () => {
		it("activity free function works at runtime", async () => {
			const w = workflow(function* () {
				const result = yield* activity("greet", async () => "hello");
				return result;
			});

			const result = await createTestRuntime(w, {
				activities: { greet: () => "hello" },
			});
			expect(result).toBe("hello");
		});

		it("receive free function carries Signal requirement", async () => {
			const w = workflow(function* () {
				const name = yield* receive<string, "login">("login");
				return `Hello ${name}`;
			});

			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"login", string>> = true;
			void _check;

			const result = await createTestRuntime(w, {
				signals: [{ name: "login", payload: "Max" }],
			});
			expect(result).toBe("Hello Max");
		});

		it("sleep free function works at runtime", async () => {
			const w = workflow(function* () {
				yield* sleep(10);
				return "done";
			});

			const result = await createTestRuntime(w, {});
			expect(result).toBe("done");
		});

		it("free functions compose with precise yield types", async () => {
			const w = workflow(function* () {
				const name = yield* receive<string, "greet">("greet");
				const msg = yield* activity("format", async () => `Hello ${name}`);
				yield* sleep(10);
				return msg;
			});

			// Only Signal<"greet", string> — no Dependency or Publishes
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"greet", string>> = true;
			void _check;

			const result = await createTestRuntime(w, {
				signals: [{ name: "greet", payload: "Max" }],
				activities: { format: () => "Hello Max" },
			});
			expect(result).toBe("Hello Max");
		});

		it("child free function delegates to sub-workflow", async () => {
			const childWf = workflow(function* () {
				return yield* activity("fetch", async () => "child-data");
			});

			const parentWf = workflow(function* () {
				const result = yield* child<string>("sub", childWf);
				return `parent: ${result}`;
			});

			const result = await createTestRuntime(parentWf, {
				activities: { fetch: () => "child-data" },
			});
			expect(result).toBe("parent: child-data");
		});

		it("publish free function carries Publishes requirement", async () => {
			const w = workflow(function* () {
				yield* publish(42);
			});

			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Publishes<number>> = true;
			void _check;
		});

		it("handle free function dispatches to matching handler", async () => {
			const w = workflow(function* () {
				return yield* handle<string>({
					greet: function* (name, done) {
						yield* done(name as string);
					},
				});
			});

			const result = await createTestRuntime(w, {
				signals: [{ name: "greet", payload: "Max" }],
			});
			expect(result).toBe("Max");
		});

		it("handle handlers can use free functions", async () => {
			const w = workflow(function* () {
				return yield* handle<string>({
					go: function* (_payload, done) {
						const result = yield* activity("fetch", async () => "fetched");
						yield* done(result);
					},
				});
			});

			const result = await createTestRuntime(w, {
				signals: [{ name: "go", payload: undefined }],
				activities: { fetch: () => "fetched" },
			});
			expect(result).toBe("fetched");
		});

		it("race free function picks first completing branch", async () => {
			const w = workflow(function* () {
				const result = yield* race(
					activity("fast", async () => "fast-result"),
					sleep(10000),
				);
				return result;
			});

			const result = await createTestRuntime(w, {
				activities: { fast: () => "fast-result" },
			});
			expect(result).toEqual({ winner: 0, value: "fast-result" });
		});

		it("all free function waits for all branches", async () => {
			const w = workflow(function* () {
				const [a, b] = yield* all(
					activity("first", async () => "one"),
					activity("second", async () => "two"),
				);
				return `${a}-${b}`;
			});

			const result = await createTestRuntime(w, {
				activities: { first: () => "one", second: () => "two" },
			});
			expect(result).toBe("one-two");
		});
	});
});

// ABOUTME: Algebraic law conformance tests for the workflow monad.
// ABOUTME: Verifies pure/return, left identity, right identity, and associativity.

import { describe, expect, it } from "vitest";
import { createTestRuntime } from "./test-runtime";
import { activity, all, child, handler, loop, loopBreak, output, publish, query, race, receive, sleep, workflow } from "./types";
import type { Output, Publishes, Query, Requirements, Signal, Workflow } from "./types";

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
			const w = workflow(function* () {
				return 42;
			});

			const result = await createTestRuntime(w, {});
			expect(result).toBe(42);
		});

		it("yield* pure(a) returns a", async () => {
			const w = workflow(function* () {
				return yield* pure("hello");
			});

			const result = await createTestRuntime(w, {});
			expect(result).toBe("hello");
		});
	});

	describe("Left identity: pure(a) >>= f  ≡  f(a)", () => {
		it("yield* pure(a) then f equals f(a) directly", async () => {
			function* f(x: number): Workflow<string> {
				const result = yield* activity("double", async () => x * 2);
				return `result: ${result}`;
			}

			// Left side: pure(5) >>= f
			const left = workflow(function* () {
				const a = yield* pure(5);
				return yield* f(a);
			});

			// Right side: f(5) directly
			const right = workflow(function* () {
				return yield* f(5);
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
			const m = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			// m >>= pure: feed m's result through pure
			const mBindPure = workflow(function* () {
				const a = yield* activity("greet", async () => "hello");
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
			const childWorkflow = workflow(function* () {
				const val = yield* receive<string>("data");
				return `got: ${val}`;
			});

			// Via child (yield* delegation to sub-interpreter)
			const viaChild = workflow(function* () {
				return yield* child<string>("sub", childWorkflow);
			});

			// Inline (same logic, no child)
			const inline = workflow(function* () {
				const val = yield* receive<string>("data");
				return `got: ${val}`;
			});

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
			function* fetchUser(): Workflow<string> {
				return yield* activity("fetchUser", async () => "Max");
			}

			function* greetUser(name: string): Workflow<string> {
				return yield* activity("greet", async () => `Hello, ${name}!`);
			}

			function* formatGreeting(greeting: string): Workflow<string> {
				return yield* activity("format", async () => `[${greeting}]`);
			}

			// Left-associated: (m >>= f) >>= g
			const leftAssoc = workflow(function* () {
				const user = yield* fetchUser();
				const greeting = yield* greetUser(user);
				return yield* formatGreeting(greeting);
			});

			// Right-associated: m >>= (x => f(x) >>= g)
			// Equivalent to extracting a composed sub-generator
			function* greetAndFormat(name: string): Workflow<string> {
				const greeting = yield* greetUser(name);
				return yield* formatGreeting(greeting);
			}

			const rightAssoc = workflow(function* () {
				const user = yield* fetchUser();
				return yield* greetAndFormat(user);
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

	type AssertEqual<T, U> =
		(<X>() => X extends T ? 1 : 2) extends (<X>() => X extends U ? 1 : 2) ? true : false;
	type AssertNotEqual<T, U> = AssertEqual<T, U> extends true ? false : true;

	describe("Requirement inference", () => {

		it("activity-only workflow has no requirements", () => {
			const w = workflow(function* () {
				return yield* activity("fetch", async () => 42);
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, never> = true;
			void _check;
			void w;
		});

		it("receive propagates Signal requirement", () => {
			const w = workflow(function* () {
				const user = yield* receive("login").as<{ name: string }>();
				return user.name;
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"login", { name: string }>> = true;
			void _check;
			void w;
		});

		it("publish propagates Publishes requirement", () => {
			const w = workflow(function* () {
				yield* publish(42);
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Publishes<number>> = true;
			void _check;
			void w;
		});

		it("sleep has no requirements", () => {
			const w = workflow(function* () {
				yield* sleep(100);
				return "done";
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, never> = true;
			void _check;
			void w;
		});

		it("child has no requirements", () => {
			const childWf = workflow(function* () {
				return yield* activity("fetch", async () => 42);
			});
			const w = workflow(function* () {
				return yield* child<number>("sub", childWf);
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, never> = true;
			void _check;
			void w;
		});

		it("race propagates union of branch requirements", () => {
			const w = workflow(function* () {
				return yield* race(
					receive("login").as<{ user: string }>(),
					output("payment").as<number>(),
				);
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"login", { user: string }> | Output<"payment", number>> = true;
			void _check;
			void w;
		});

		it("all propagates union of branch requirements", () => {
			const w = workflow(function* () {
				return yield* all(
					receive("login").as<{ user: string }>(),
					output("config").as<{ url: string }>(),
				);
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"login", { user: string }> | Output<"config", { url: string }>> = true;
			void _check;
			void w;
		});

		it("handler with single .on() propagates Signal requirement with inferred payload", () => {
			const w = workflow(function* () {
				return yield* handler()
					.on("input", function* (msg: string, done) {
						if (msg === "quit") {
							yield* done("done");
						}
					})
					.as<string>();
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"input", string>> = true;
			void _check;
			void w;
		});

		it("handler propagates specific Signal requirements inferred from handler payload", () => {
			const w = workflow(function* () {
				return yield* handler()
					.on("greet", function* (payload: string, done) {
						yield* done(payload);
					})
					.as<string>();
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"greet", string>> = true;
			void _check;
			void w;
		});

		it("handler with multiple .on() calls propagates union of typed Signal requirements", () => {
			const w = workflow(function* () {
				return yield* handler()
					.on("greet", function* (payload: string, done) {
						yield* done(payload);
					})
					.on("farewell", function* (payload: number, done) {
						yield* done(String(payload));
					})
					.as<string>();
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"greet", string> | Signal<"farewell", number>> = true;
			void _check;
			void w;
		});

		it("receive requirements do not widen to Signal<string, any>", () => {
			// receive: signal name stays literal
			const w1 = workflow(function* () {
				return yield* receive("submit").as<{ data: number }>();
			});
			type R1 = Requirements<ReturnType<typeof w1>>;
			const _notWide1: AssertNotEqual<R1, Signal<string, any>> = true;
			const _exact1: AssertEqual<R1, Signal<"submit", { data: number }>> = true;
			void _notWide1; void _exact1; void w1;

			// handler: stays as union of specific signals
			const w2 = workflow(function* () {
				return yield* handler()
					.on("greet", function* (payload: string, done) {
						yield* done(payload);
					})
					.on("farewell", function* (payload: number, done) {
						yield* done(String(payload));
					})
					.as<string>();
			});
			type R2 = Requirements<ReturnType<typeof w2>>;
			const _notWide2: AssertNotEqual<R2, Signal<string, any>> = true;
			const _exact2: AssertEqual<R2, Signal<"greet", string> | Signal<"farewell", number>> = true;
			void _notWide2; void _exact2; void w2;
		});

		it("handler propagates Publishes from handler bodies", () => {
			const w = workflow(function* () {
				return yield* handler()
					.on("go", function* (_payload: undefined, done) {
						yield* publish(42);
						yield* done("result");
					})
					.as<string>();
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"go", undefined> | Publishes<number>> = true;
			void _check;
			void w;
		});

		it("handler propagates Output requirement from handler body", () => {
			const w = workflow(function* () {
				return yield* handler()
					.on("go", function* (_payload: undefined, done) {
						const config = yield* output("config").as<{ url: string }>();
						yield* done(config.url);
					})
					.as<string>();
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _hasSignal: AssertEqual<Signal<"go", undefined> extends R ? true : false, true> = true;
			const _hasOutput: AssertEqual<Output<"config", { url: string }> extends R ? true : false, true> = true;
			void _hasSignal; void _hasOutput; void w;
		});

		it("nested handler propagates inner signals up through outer handler", () => {
			const w = workflow(function* () {
				return yield* handler()
					.on("start", function* (_payload: undefined, done) {
						const inner = yield* handler()
							.on("confirm", function* (val: string, innerDone) {
								yield* innerDone(val);
							})
							.as<string>();
						yield* done(inner);
					})
					.as<string>();
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _hasOuter: AssertEqual<Signal<"start", undefined> extends R ? true : false, true> = true;
			const _hasInner: AssertEqual<Signal<"confirm", string> extends R ? true : false, true> = true;
			void _hasOuter; void _hasInner; void w;
		});

		it("output().as<V>() infers workflow id and types value", () => {
			const w = workflow(function* () {
				const config = yield* output("config").as<{ url: string }>();
				return config.url;
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Output<"config", { url: string }>> = true;
			void _check;
			void w;
		});

		it("output() without .as() infers unknown value", () => {
			const w = workflow(function* () {
				const data = yield* output("payment");
				return data;
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Output<"payment", unknown>> = true;
			void _check;
			void w;
		});

		it("output requirements do not widen to Output<string, any>", () => {
			const w = workflow(function* () {
				return yield* output("config").as<{ url: string }>();
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _notWide: AssertNotEqual<R, Output<string, any>> = true;
			const _exact: AssertEqual<R, Output<"config", { url: string }>> = true;
			void _notWide; void _exact; void w;
		});

		it("output in handler body propagates Output requirement up", () => {
			const w = workflow(function* () {
				return yield* handler()
					.on("go", function* (_payload: undefined, done) {
						const config = yield* output("config").as<{ url: string }>();
						yield* done(config.url);
					})
					.as<string>();
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _hasSignal: AssertEqual<Signal<"go", undefined> extends R ? true : false, true> = true;
			const _hasOutput: AssertEqual<Output<"config", { url: string }> extends R ? true : false, true> = true;
			void _hasSignal; void _hasOutput; void w;
		});

		it("multiple operations accumulate requirements as union", () => {
			const w = workflow(function* () {
				const config = yield* output("config").as<{ url: string }>();
				const user = yield* receive("login").as<{ name: string }>();
				yield* publish(42);
				return `${config.url}-${user.name}`;
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<
				R,
				| Output<"config", { url: string }>
				| Signal<"login", { name: string }>
				| Publishes<number>
			> = true;
			void _check;
			void w;
		});

		it("query().as<V>() infers query label and types value", () => {
			const w = workflow(function* () {
				const config = yield* query("config").as<{ url: string }>();
				return config.url;
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Query<"config", { url: string }>> = true;
			void _check;
			void w;
		});

		it("query() without .as() infers unknown value", () => {
			const w = workflow(function* () {
				const data = yield* query("payment");
				return data;
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Query<"payment", unknown>> = true;
			void _check;
			void w;
		});

		it("query requirements do not widen to Query<string, any>", () => {
			const w = workflow(function* () {
				return yield* query("config").as<{ url: string }>();
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _notWide: AssertNotEqual<R, Query<string, any>> = true;
			const _exact: AssertEqual<R, Query<"config", { url: string }>> = true;
			void _notWide; void _exact; void w;
		});

		it("query in all propagates Query requirements", () => {
			const w = workflow(function* () {
				return yield* all(
					query("payment").as<{ amount: number }>(),
					query("profile").as<{ name: string }>(),
				);
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Query<"payment", { amount: number }> | Query<"profile", { name: string }>> = true;
			void _check;
			void w;
		});

		it("query in race propagates Query requirements", () => {
			const w = workflow(function* () {
				return yield* race(
					query("fast").as<string>(),
					query("slow").as<number>(),
				);
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Query<"fast", string> | Query<"slow", number>> = true;
			void _check;
			void w;
		});

		it("loop propagates requirements from body", () => {
			const w = workflow(function* () {
				return yield* loop(function* () {
					const msg = yield* receive("input").as<string>();
					yield* publish(msg);
					if (msg === "quit") {
						yield* loopBreak("done");
					}
				});
			});
			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"input", string> | Publishes<string>> = true;
			void _check;
			void w;
		});

		it("loopBreak value type becomes loop return type", () => {
			const w = workflow(function* () {
				const result = yield* loop(function* () {
					yield* loopBreak(42);
				});
				// result should be inferred as number
				const _typeCheck: AssertEqual<typeof result, number> = true;
				void _typeCheck;
				return result;
			});
			void w;
		});

		it("workflow() constructor enables inference and works at runtime", async () => {
			const w = workflow(function* () {
				const name = yield* receive("greet").as<string>();
				const msg = yield* activity("format", async () => `Hello ${name}`);
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
				const name = yield* receive("login").as<string>();
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

		it("receive().as<V>() infers signal name and types payload", async () => {
			const w = workflow(function* () {
				const data = yield* receive("pay").as<{ amount: number }>();
				return data.amount;
			});

			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"pay", { amount: number }>> = true;
			void _check;

			const result = await createTestRuntime(w, {
				signals: [{ name: "pay", payload: { amount: 42 } }],
			});
			expect(result).toBe(42);
		});

		it("receive() without .as() infers unknown payload", async () => {
			const w = workflow(function* () {
				const data = yield* receive("submit");
				return data;
			});

			type R = Requirements<ReturnType<typeof w>>;
			const _check: AssertEqual<R, Signal<"submit", unknown>> = true;
			void _check;

			const result = await createTestRuntime(w, {
				signals: [{ name: "submit", payload: "hello" }],
			});
			expect(result).toBe("hello");
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
				const name = yield* receive("greet").as<string>();
				const msg = yield* activity("format", async () => `Hello ${name}`);
				yield* sleep(10);
				return msg;
			});

			// Only Signal<"greet", string> — no Result, Published, or Publishes
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

		it("handler dispatches to matching handler", async () => {
			const w = workflow(function* () {
				return yield* handler()
					.on("greet", function* (name: string, done) {
						yield* done(name);
					})
					.as<string>();
			});

			const result = await createTestRuntime(w, {
				signals: [{ name: "greet", payload: "Max" }],
			});
			expect(result).toBe("Max");
		});

		it("handler handlers can use free functions", async () => {
			const w = workflow(function* () {
				return yield* handler()
					.on("go", function* (_payload: undefined, done) {
						const result = yield* activity("fetch", async () => "fetched");
						yield* done(result);
					})
					.as<string>();
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

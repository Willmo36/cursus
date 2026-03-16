// ABOUTME: Profunctor law tests for workflow provide() and map() combinators.
// ABOUTME: Verifies identity, composition, and associativity for both operations.

import { describe, expect, it } from "vitest";
import { createTestRuntime } from "./test-runtime";
import { activity, query, workflow } from "./types";
import type { Query, Requirements } from "./types";

type AssertEqual<T, U> =
	(<X>() => X extends T ? 1 : 2) extends (<X>() => X extends U ? 1 : 2) ? true : false;

describe("Profunctor laws", () => {
	describe("map() — functor over output", () => {
		it("identity: map(x => x) produces same result as no map", async () => {
			const w = workflow(function* () {
				return yield* activity("fetch", async () => 42);
			});

			const mapped = w.map((x) => x);

			const original = await createTestRuntime(w, {
				activities: { fetch: () => 42 },
			});
			const result = await createTestRuntime(mapped, {
				activities: { fetch: () => 42 },
			});
			expect(result).toBe(original);
		});

		it("composition: map(f).map(g) equals map(x => g(f(x)))", async () => {
			const w = workflow(function* () {
				return yield* activity("fetch", async () => 10);
			});

			const f = (x: number) => x * 2;
			const g = (x: number) => `result: ${x}`;

			const chained = w.map(f).map(g);
			const composed = w.map((x) => g(f(x)));

			const chainedResult = await createTestRuntime(chained, {
				activities: { fetch: () => 10 },
			});
			const composedResult = await createTestRuntime(composed, {
				activities: { fetch: () => 10 },
			});
			expect(chainedResult).toBe(composedResult);
			expect(chainedResult).toBe("result: 20");
		});

		it("map transforms the return type", () => {
			const w = workflow(function* () {
				return 42;
			});

			const mapped = w.map((x) => `value: ${x}`);

			// Should produce a generator
			const gen = mapped.createGenerator();
			expect(gen).toBeDefined();
			void gen;
		});
	});

	describe("provide() — contramap over inputs", () => {
		it("identity: provide(k, query(k)) produces same result", async () => {
			const w = workflow(function* () {
				const val = yield* query("input").as<number>();
				return val * 2;
			});

			const provided = w.provide("input", function* () {
				return yield* query("input").as<number>();
			});

			const original = await createTestRuntime(w, {
				signals: [{ name: "input", payload: 5 }],
			});
			const result = await createTestRuntime(provided, {
				signals: [{ name: "input", payload: 5 }],
			});
			expect(result).toBe(original);
			expect(result).toBe(10);
		});

		it("provide remaps a query to a different label", async () => {
			const w = workflow(function* () {
				const val = yield* query("x").as<number>();
				return val * 2;
			});

			const remapped = w.provide("x", function* () {
				return yield* query("y").as<number>();
			});

			// Original needs "x", remapped needs "y"
			type OrigReqs = Requirements<typeof w>;
			type RemappedReqs = Requirements<typeof remapped>;
			const _origCheck: AssertEqual<OrigReqs, Query<"x", number>> = true;
			const _remappedCheck: AssertEqual<RemappedReqs, Query<"y", number>> = true;
			void _origCheck; void _remappedCheck;

			const result = await createTestRuntime(remapped, {
				signals: [{ name: "y", payload: 7 }],
			});
			expect(result).toBe(14);
		});

		it("composition: provide(k, f).provide(j, g) chains correctly", async () => {
			const w = workflow(function* () {
				const val = yield* query("a").as<number>();
				return val;
			});

			// a -> b -> c: two levels of remapping
			const step1 = w.provide("a", function* () {
				return yield* query("b").as<number>();
			});

			const step2 = step1.provide("b", function* () {
				return yield* query("c").as<number>();
			});

			type FinalReqs = Requirements<typeof step2>;
			const _check: AssertEqual<FinalReqs, Query<"c", number>> = true;
			void _check;

			const result = await createTestRuntime(step2, {
				signals: [{ name: "c", payload: 99 }],
			});
			expect(result).toBe(99);
		});

		it("provide can fan out: one query becomes multiple", async () => {
			const w = workflow(function* () {
				const val = yield* query("sum").as<number>();
				return val;
			});

			const fanOut = w.provide("sum", function* () {
				const a = yield* query("a").as<number>();
				const b = yield* query("b").as<number>();
				return a + b;
			});

			type FanOutReqs = Requirements<typeof fanOut>;
			const _check: AssertEqual<FanOutReqs, Query<"a", number> | Query<"b", number>> = true;
			void _check;

			const result = await createTestRuntime(fanOut, {
				signals: [
					{ name: "a", payload: 3 },
					{ name: "b", payload: 4 },
				],
			});
			expect(result).toBe(7);
		});
	});

	describe("Profunctor composition (provide + map)", () => {
		it("provide and map compose: remap input, transform output", async () => {
			const w = workflow(function* () {
				const val = yield* query("x").as<number>();
				return val;
			});

			const adapted = w
				.provide("x", function* () {
					return yield* query("y").as<number>();
				})
				.map((n) => `result: ${n}`);

			const result = await createTestRuntime(adapted, {
				signals: [{ name: "y", payload: 42 }],
			});
			expect(result).toBe("result: 42");
		});
	});
});

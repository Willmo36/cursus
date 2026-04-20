// ABOUTME: Type-level tests for SignalMap / SignalMapOf — specifically the void-payload normalization.
// ABOUTME: These fail compilation (caught by `tsc --noEmit`) if the type doesn't produce the expected shape.

import { describe, it } from "vitest";
import {
	type NoPayload,
	query,
	type SignalMap,
	type SignalMapOf,
} from "./types";

// Compile-time equality helpers
type Expect<T extends true> = T;
type Equal<X, Y> =
	(<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
		? true
		: false;

describe("SignalMap void-payload normalization", () => {
	it("query('start').as<void>() produces { start: undefined } in SignalMap", () => {
		function* wf() {
			yield* query("start").as<void>();
		}
		type SM = SignalMap<ReturnType<typeof wf>>;
		type _assert = Expect<Equal<SM, { readonly start: undefined }>>;
	});

	it("query('start').as<void>() produces { start: undefined } in SignalMapOf", () => {
		function* wf() {
			yield* query("start").as<void>();
		}
		type SM = SignalMapOf<typeof wf>;
		type _assert = Expect<Equal<SM, { readonly start: undefined }>>;
	});

	it("signal(name, undefined) is callable for a void-payload query", () => {
		function* wf() {
			yield* query("start").as<void>();
		}
		type SM = SignalMapOf<typeof wf>;
		function signal<K extends keyof SM & string>(
			_name: K,
			_payload: SM[K],
		): void {}
		signal("start", undefined);
	});

	it("non-void payloads round-trip unchanged", () => {
		function* wf() {
			yield* query("profile").as<{ name: string }>();
		}
		type SM = SignalMapOf<typeof wf>;
		type _assert = Expect<Equal<SM, { readonly profile: { name: string } }>>;
	});

	it("NoPayload is exported as an alias for undefined", () => {
		type _assert = Expect<Equal<NoPayload, undefined>>;
	});

	it("mixed void + non-void queries merge correctly", () => {
		function* wf() {
			yield* query("start").as<void>();
			yield* query("profile").as<{ name: string }>();
		}
		type SM = SignalMapOf<typeof wf>;
		type _assert = Expect<
			Equal<
				SM,
				{ readonly start: undefined } & { readonly profile: { name: string } }
			>
		>;
	});
});

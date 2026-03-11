// ABOUTME: Prototype for monadic workflow types with requirement propagation.
// ABOUTME: Requirements accumulate through yield* like Effect-TS Effect.gen.

// --- Requirement tags ---

// Declares that a workflow receives signal K with payload V
export type Signal<K extends string = string, V = unknown> = {
	readonly _tag: "signal";
	readonly signal: { readonly [P in K]: V };
};

// Declares that a workflow reads published value V from workflow K
export type Dependency<K extends string = string, V = unknown> = {
	readonly _tag: "dependency";
	readonly dependency: { readonly [P in K]: V };
};

// Declares that a workflow publishes values of type V
export type Publishes<V = unknown> = {
	readonly _tag: "publishes";
	readonly publishes: V;
};

// Union of all requirement tags
export type Requirement = Signal | Dependency | Publishes;

// --- Step (internal yield carrier) ---

// Branded type that carries a requirement through the generator's Yield parameter.
// Users never reference this directly — they just yield* it.
type Step<R extends Requirement = never> = {
	readonly __requirement?: R;
	readonly __step: true;
};

// --- Workflow ---

// The monad. A generator that yields Steps and returns A.
// R accumulates as a union of all yielded Steps' requirements.
export type Workflow<A, R extends Requirement = never> = Generator<Step<R>, A, unknown>;

// --- Requirements (extractor) ---

// Extracts the accumulated requirements from a Workflow or Step union
export type Requirements<W> =
	W extends Workflow<unknown, infer R> ? R :
	W extends Step<infer R> ? R :
	never;

// --- workflow() constructor ---

// Wraps a generator function into a Workflow, inferring R from all yields.
// This is our Effect.gen equivalent.
declare function workflow<Eff extends Step<Requirement>, A>(
	f: () => Generator<Eff, A, unknown>,
): Workflow<A, Requirements<Eff>>;

// --- Context ---

// Context provided to workflow generators. Each method returns a
// Workflow (single-step) branded with its requirement.
type Context<
	Signals extends Record<string, unknown> = Record<string, unknown>,
	Deps extends Record<string, unknown> = Record<string, never>,
	Pub = never,
> = {
	activity: <T>(
		name: string,
		fn: (signal: AbortSignal) => Promise<T>,
	) => Workflow<T, never>;

	sleep: (durationMs: number) => Workflow<void, never>;

	receive: <K extends keyof Signals & string>(
		signal: K,
	) => Workflow<Signals[K], Signal<K, Signals[K]>>;

	published: <K extends keyof Deps & string>(
		workflowId: K,
	) => Workflow<Deps[K], Dependency<K, Deps[K]>>;

	publish: (value: Pub) => Workflow<void, Publishes<Pub>>;
};

// --- Combinators ---

declare function race<
	EffA extends Step<Requirement>,
	A,
	EffB extends Step<Requirement>,
	B,
>(
	a: Generator<EffA, A, unknown>,
	b: Generator<EffB, B, unknown>,
): Workflow<
	{ winner: 0; value: A } | { winner: 1; value: B },
	Requirements<EffA> | Requirements<EffB>
>;

// --- Tests ---

type AssertEqual<T, U> = [T] extends [U] ? [U] extends [T] ? true : false : false;

// Test 1: Single requirement
declare const ctx1: Context<{ login: { name: string } }>;

const w1 = workflow(function* () {
	const user = yield* ctx1.receive("login");
	return user.name;
});

type T1 = AssertEqual<
	Requirements<typeof w1>,
	Signal<"login", { name: string }>
>;
const _t1: T1 = true;

// Test 2: Multiple requirements accumulate
declare const ctx2: Context<
	{ login: { name: string } },
	{ config: { url: string } },
	number
>;

const w2 = workflow(function* () {
	const config = yield* ctx2.published("config");
	const creds = yield* ctx2.receive("login");
	yield* ctx2.publish(42);
	const data = yield* ctx2.activity("fetch", async () => "data");
	return `${config.url}-${creds.name}-${data}`;
});

type T2 = AssertEqual<
	Requirements<typeof w2>,
	| Dependency<"config", { url: string }>
	| Signal<"login", { name: string }>
	| Publishes<number>
>;
const _t2: T2 = true;

// Test 3: Race merges requirements
declare const ctx3: Context<{ payment: number; cancel: void }>;

const w3 = workflow(function* () {
	return yield* race(
		ctx3.receive("payment"),
		ctx3.receive("cancel"),
	);
});

type T3 = AssertEqual<
	Requirements<typeof w3>,
	Signal<"payment", number> | Signal<"cancel", void>
>;
const _t3: T3 = true;

// Test 4: Nested workflow requirements propagate
declare function embed<Eff extends Step<Requirement>, A>(
	w: Generator<Eff, A, unknown>,
): Workflow<A, Requirements<Eff>>;

declare const ctxInner: Context<{ inner: string }>;
declare const ctxOuter: Context<{ outer: number }>;

const inner = workflow(function* () {
	return yield* ctxInner.receive("inner");
});

const w4 = workflow(function* () {
	const a = yield* ctxOuter.receive("outer");
	const b = yield* embed(inner);
	return `${a}-${b}`;
});

type T4 = AssertEqual<
	Requirements<typeof w4>,
	Signal<"outer", number> | Signal<"inner", string>
>;
const _t4: T4 = true;

// Test 5: Activity-only workflow has no requirements
declare const ctx5: Context;

const w5 = workflow(function* () {
	const a = yield* ctx5.activity("fetch", async () => 42);
	const b = yield* ctx5.activity("save", async () => "ok");
	return `${a}-${b}`;
});

type T5 = AssertEqual<Requirements<typeof w5>, never>;
const _t5: T5 = true;

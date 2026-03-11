// ABOUTME: Prototype for monadic workflow types with requirement propagation.
// ABOUTME: Requirements accumulate through yield* like Effect-TS Effect.gen.

// --- Requirements ---

type SignalReq<K extends string = string, V = unknown> = {
	readonly _tag: "signals";
	readonly signals: { readonly [P in K]: V };
};

type DepReq<K extends string = string, V = unknown> = {
	readonly _tag: "deps";
	readonly deps: { readonly [P in K]: V };
};

type PublishReq<V = unknown> = {
	readonly _tag: "publish";
	readonly publish: V;
};

type Req = SignalReq | DepReq | PublishReq;

// --- Branded Command ---

// A command that carries its requirement as a phantom type.
// At runtime this is just a Command. The R is erased.
type Cmd<A, R extends Req = never> = Generator<CmdYield<R>, A, unknown>;

// The yield type carries the requirement brand
type CmdYield<R extends Req = never> = {
	readonly __req?: R;
	readonly __cmd: true;
};

// --- Workflow ---

// A workflow is a generator that yields branded commands.
// The Yield union accumulates all requirements.
type Workflow<A, R extends Req = never> = Generator<CmdYield<R>, A, unknown>;

// --- Workflow constructor (our Effect.gen) ---

// Extracts R from the yield type union
type ExtractReq<Eff> = Eff extends CmdYield<infer R> ? R : never;

// The workflow() wrapper infers R from the generator's yield type
declare function workflow<Eff extends CmdYield<Req>, A>(
	f: () => Generator<Eff, A, unknown>,
): Workflow<A, ExtractReq<Eff>>;

// --- Context methods (return branded Cmds) ---

type Ctx = {
	activity: <T>(
		name: string,
		fn: () => Promise<T>,
	) => Cmd<T, never>;

	sleep: (durationMs: number) => Cmd<void, never>;

	receive: <K extends string, V>(
		signal: K,
	) => Cmd<V, SignalReq<K, V>>;

	published: <K extends string, V>(
		workflowId: K,
	) => Cmd<V, DepReq<K, V>>;

	publish: <V>(value: V) => Cmd<void, PublishReq<V>>;
};

// --- Test: does inference work? ---

declare const ctx: Ctx;

// Test 1: single requirement
const w1 = workflow(function* () {
	const user = yield* ctx.receive<"login", { name: string }>("login");
	return user.name;
});
// Expected: Workflow<string, SignalReq<"login", { name: string }>>

// Test 2: multiple requirements accumulate
const w2 = workflow(function* () {
	const config = yield* ctx.published<"config", { url: string }>("config");
	const creds = yield* ctx.receive<"login", { name: string }>("login");
	const result = yield* ctx.activity("fetch", async () => "data");
	return result;
});
// Expected: Workflow<string, DepReq<"config", { url: string }> | SignalReq<"login", { name: string }>>
// (activity adds never, which drops out of the union)

// Test 3: race should merge requirements
declare function race<
	EffA extends CmdYield<Req>,
	A,
	EffB extends CmdYield<Req>,
	B,
>(
	a: Generator<EffA, A, unknown>,
	b: Generator<EffB, B, unknown>,
): Cmd<{ winner: 0; value: A } | { winner: 1; value: B }, ExtractReq<EffA> | ExtractReq<EffB>>;

const w3 = workflow(function* () {
	const result = yield* race(
		ctx.receive<"payment", number>("payment"),
		ctx.receive<"cancel", void>("cancel"),
	);
	return result;
});
// Expected: Workflow<..., SignalReq<"payment", number> | SignalReq<"cancel", void>>

// Test 4: nested workflow requirements propagate
declare function sub<Eff extends CmdYield<Req>, A>(
	w: Generator<Eff, A, unknown>,
): Cmd<A, ExtractReq<Eff>>;

const inner = workflow(function* () {
	return yield* ctx.receive<"inner", string>("inner");
});

const w4 = workflow(function* () {
	const a = yield* ctx.receive<"outer", number>("outer");
	const b = yield* sub(inner);
	return `${a}-${b}`;
});
// Expected: Workflow<string, SignalReq<"outer", number> | SignalReq<"inner", string>>

// --- Test 5: Realistic ctx with typed maps ---

type TypedCtx<
	Signals extends Record<string, unknown>,
	Deps extends Record<string, unknown>,
	Pub,
> = {
	activity: <T>(
		name: string,
		fn: () => Promise<T>,
	) => Cmd<T, never>;

	sleep: (durationMs: number) => Cmd<void, never>;

	receive: <K extends keyof Signals & string>(
		signal: K,
	) => Cmd<Signals[K], SignalReq<K, Signals[K]>>;

	published: <K extends keyof Deps & string>(
		workflowId: K,
	) => Cmd<Deps[K], DepReq<K, Deps[K]>>;

	publish: (value: Pub) => Cmd<void, PublishReq<Pub>>;
};

type MySignals = { login: { user: string }; logout: void };
type MyDeps = { config: { url: string } };

declare const typedCtx: TypedCtx<MySignals, MyDeps, number>;

const w5 = workflow(function* () {
	const config = yield* typedCtx.published("config");
	//    ^? should be { url: string }
	const creds = yield* typedCtx.receive("login");
	//    ^? should be { user: string }
	yield* typedCtx.publish(42);
	const data = yield* typedCtx.activity("fetch", async () => "hello");
	return `${config.url}-${creds.user}-${data}`;
});

type Test5 = AssertEqual<
	ReqOf<typeof w5>,
	| DepReq<"config", { url: string }>
	| SignalReq<"login", { user: string }>
	| PublishReq<number>
>;

// --- Type-level tests ---

// Helper to check types at compile time
type AssertEqual<T, U> = [T] extends [U] ? [U] extends [T] ? true : false : false;

// Extract the requirement from a workflow
type ReqOf<W> = W extends Workflow<unknown, infer R> ? R : never;

// Test assertions
type Test1 = AssertEqual<ReqOf<typeof w1>, SignalReq<"login", { name: string }>>;
type Test2 = AssertEqual<
	ReqOf<typeof w2>,
	DepReq<"config", { url: string }> | SignalReq<"login", { name: string }>
>;
type Test3 = AssertEqual<
	ReqOf<typeof w3>,
	SignalReq<"payment", number> | SignalReq<"cancel", void>
>;

type Test4 = AssertEqual<
	ReqOf<typeof w4>,
	SignalReq<"outer", number> | SignalReq<"inner", string>
>;

// These will error if the type assertions are false
const _test1: Test1 = true;
const _test2: Test2 = true;
const _test3: Test3 = true;
const _test4: Test4 = true;
const _test5: Test5 = true;

// Export to prevent unused warnings
export type { Cmd, CmdYield, Ctx, Req, Workflow, Test1, Test2, Test3 };

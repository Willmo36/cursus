// ABOUTME: Core type definitions for the workflow engine.
// ABOUTME: Defines commands, events, context, and storage interfaces.

// --- Race result discriminated union ---

type RaceResult<T extends unknown[]> = {
	[I in keyof T]: I extends `${infer N extends number}`
		? { winner: N; value: T[I] }
		: never;
}[number];

// --- Cancellation ---

export class CancelledError extends Error {
	constructor() {
		super("Workflow cancelled");
		this.name = "CancelledError";
	}
}

// --- Requirement tags ---

// Declares that a workflow needs a named, typed value from outside
export type Query<K extends string = string, V = unknown> = {
	readonly _tag: "query";
	readonly query: { readonly [P in K]: V };
};

// Declares that a workflow publishes values of type V
export type Publishes<V = unknown> = {
	readonly _tag: "publishes";
	readonly publishes: V;
};

// Union of all requirement tags
export type Requirement = Query | Publishes;

// --- Requires (internal yield carrier) ---

// Branded type that carries a requirement through the generator's Yield parameter.
// Users never reference this directly — they just yield* it.
// At runtime, the yielded value is a Command object; Requires' fields are phantom.
export type Requires<R extends Requirement = never> = {
	readonly __requirement?: R;
	readonly __step?: true;
};

// --- Requirements (extractor) ---

// Extracts the accumulated requirements from a Workflow, Generator, or Requires.
// Reads the phantom __requirement field, filtering through Requirement
// to strip undefined (from optional fields with never).
export type Requirements<W> =
	W extends Generator<infer Y, unknown, unknown>
		? Y extends { __requirement?: infer R }
			? R extends Requirement
				? R
				: never
			: never
		: W extends { readonly __requirement?: infer R }
			? R extends Requirement
				? R
				: never
			: never;

// Canonical "no payload" spelling for queries that don't carry data.
// Prefer this over `void` in `query('name').as<NoPayload>()` calls.
export type NoPayload = undefined;

// Extracts a signal map { name: payload } from a workflow function's requirements.
// Filters to Signal requirements and builds a record from their key-value pairs.
// `void` payloads are normalized to `undefined` so callers can pass `undefined` explicitly.
export type SignalMap<W> =
	Requirements<W> extends infer R
		? R extends Query<infer K, infer V>
			? { readonly [P in K]: [V] extends [void] ? undefined : V }
			: never
		: never;

// Merges a union of single-key records into one record.
// e.g. { profile: UserProfile } | { payment: PaymentInfo } → { profile: UserProfile; payment: PaymentInfo }
// biome-ignore lint/complexity/noBannedTypes: {} is the identity element for intersection accumulation
type UnionToIntersection<U> = (
	U extends unknown
		? (x: U) => void
		: never
) extends (x: infer I) => void
	? I
	: never;
export type SignalMapOf<W> = W extends (...args: any[]) => infer G
	? [SignalMap<G>] extends [never]
		? Record<string, never>
		: UnionToIntersection<SignalMap<G>>
	: [SignalMap<W>] extends [never]
		? Record<string, never>
		: UnionToIntersection<SignalMap<W>>;

// --- Dependency checking utilities ---

// Extracts the return type from a Workflow or workflow function
// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
export type WorkflowReturn<W> =
	W extends Workflow<infer T, any>
		? T
		: W extends (...args: any[]) => Generator<any, infer T, any>
			? T
			: never;

// Extracts the Publishes<V> value type from a requirement union
export type ExtractPublishes<R> = R extends Publishes<infer V> ? V : never;

// Extracts requirements from a Workflow or workflow function
// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
export type ReqsOf<W> =
	W extends Workflow<any, infer R>
		? R
		: W extends (...args: any[]) => Generator<any, any, any>
			? Requirements<ReturnType<W>>
			: never;

// All dependency keys from a requirement union.
// With unified query, all requirements are flexible (auto-match registry
// or fall through to signal), so there are no mandatory dependencies.
export type DepKeys<R> = never;

// Dependency keys from R that are NOT satisfied by Provides
export type UnsatisfiedDeps<
	R,
	Provides extends Record<string, unknown>,
> = Exclude<DepKeys<R>, keyof Provides>;

// Resolves to F if all deps are satisfied, otherwise a descriptive error string
export type CheckDeps<F, Provides extends Record<string, unknown>> = [
	UnsatisfiedDeps<ReqsOf<F>, Provides>,
] extends [never]
	? F
	: `Missing dependencies: ${UnsatisfiedDeps<ReqsOf<F>, Provides> & string}`;

// --- Descriptors (yielded by workflow generators, no seq) ---

export type ActivityDescriptor = {
	type: "activity";
	name: string;
	fn: (signal: AbortSignal) => Promise<unknown>;
};

export type SleepDescriptor = {
	type: "sleep";
	durationMs: number;
};

export type ChildDescriptor = {
	type: "child";
	name: string;
	workflow: AnyWorkflow;
};

export type QueryDescriptor = {
	type: "query";
	label: string;
};

export type PublishDescriptor = {
	type: "publish";
	value: unknown;
};

export type RaceDescriptor = {
	type: "race";
	items: Descriptor[];
};

export type AllDescriptor = {
	type: "all";
	items: Descriptor[];
};

export type LoopDescriptor = {
	type: "loop";
	// biome-ignore lint/suspicious/noExplicitAny: body factory returns any generator
	body: () => Generator<any, void, any>;
};

export type LoopBreakDescriptor<V = unknown> = {
	type: "loop_break";
	value: V;
};

export type Descriptor =
	| ActivityDescriptor
	| SleepDescriptor
	| ChildDescriptor
	| QueryDescriptor
	| RaceDescriptor
	| AllDescriptor
	| PublishDescriptor
	| LoopDescriptor
	| LoopBreakDescriptor;

// --- Commands (descriptors with seq, internal to interpreter) ---

export type ActivityCommand = ActivityDescriptor & { seq: number };
export type SleepCommand = SleepDescriptor & { seq: number };
export type ChildCommand = ChildDescriptor & { seq: number };
export type QueryCommand = QueryDescriptor & { seq: number };
export type PublishCommand = PublishDescriptor & { seq: number };
export type RaceCommand = { type: "race"; items: Command[]; seq: number };
export type AllCommand = { type: "all"; items: Command[]; seq: number };
export type LoopCommand = LoopDescriptor & { seq: number };
export type LoopBreakCommand = LoopBreakDescriptor & { seq: number };

export type Command =
	| ActivityCommand
	| SleepCommand
	| ChildCommand
	| QueryCommand
	| RaceCommand
	| AllCommand
	| PublishCommand
	| LoopCommand
	| LoopBreakCommand;

// --- Events (recorded in the event log) ---

export type WorkflowStartedEvent = {
	type: "workflow_started";
	timestamp: number;
};

export type ActivityScheduledEvent = {
	type: "activity_scheduled";
	name: string;
	seq: number;
	timestamp: number;
};

export type ActivityCompletedEvent = {
	type: "activity_completed";
	seq: number;
	result: unknown;
	timestamp: number;
};

export type ActivityFailedEvent = {
	type: "activity_failed";
	seq: number;
	error: string;
	stack?: string;
	timestamp: number;
};

export type TimerStartedEvent = {
	type: "timer_started";
	seq: number;
	durationMs: number;
	timestamp: number;
};

export type TimerFiredEvent = {
	type: "timer_fired";
	seq: number;
	timestamp: number;
};

export type ChildStartedEvent = {
	type: "child_started";
	name: string;
	workflowId: string;
	seq: number;
	timestamp: number;
};

export type ChildCompletedEvent = {
	type: "child_completed";
	workflowId: string;
	seq: number;
	result: unknown;
	timestamp: number;
};

export type ChildFailedEvent = {
	type: "child_failed";
	workflowId: string;
	seq: number;
	error: string;
	stack?: string;
	timestamp: number;
};

// Signal-resolved: an external send() delivered a value for this label.
// The payload is serialized to the log and returned verbatim on replay.
export type ReceiveResolvedEvent = {
	type: "receive_resolved";
	label: string;
	value: unknown;
	seq: number;
	timestamp: number;
};

// Marker that a registry read was performed. No value is stored — on replay
// the registry re-hydrates and produces the value live. This keeps
// non-serializable values (e.g. method bundles) safe across durable storage.
export type ReadResolvedEvent = {
	type: "read_resolved";
	label: string;
	seq: number;
	timestamp: number;
};

export type WorkflowPublishedEvent = {
	type: "workflow_published";
	value: unknown;
	seq: number;
	timestamp: number;
};

export type AllStartedEvent = {
	type: "all_started";
	seq: number;
	items: Array<{ type: string }>;
	timestamp: number;
};

export type AllCompletedEvent = {
	type: "all_completed";
	seq: number;
	results: unknown[];
	timestamp: number;
};

export type RaceStartedEvent = {
	type: "race_started";
	seq: number;
	items: Array<{ type: string }>;
	timestamp: number;
};

export type RaceCompletedEvent = {
	type: "race_completed";
	seq: number;
	winner: number;
	value: unknown;
	timestamp: number;
};

export type WorkflowCompletedEvent = {
	type: "workflow_completed";
	result: unknown;
	timestamp: number;
};

export type WorkflowFailedEvent = {
	type: "workflow_failed";
	error: string;
	stack?: string;
	timestamp: number;
};

export type WorkflowCancelledEvent = {
	type: "workflow_cancelled";
	timestamp: number;
};

export type LoopStartedEvent = {
	type: "loop_started";
	seq: number;
	timestamp: number;
};

export type LoopCompletedEvent = {
	type: "loop_completed";
	seq: number;
	value: unknown;
	timestamp: number;
};

export type WorkflowEvent =
	| WorkflowStartedEvent
	| ActivityScheduledEvent
	| ActivityCompletedEvent
	| ActivityFailedEvent
	| TimerStartedEvent
	| TimerFiredEvent
	| ChildStartedEvent
	| ChildCompletedEvent
	| ChildFailedEvent
	| ReceiveResolvedEvent
	| ReadResolvedEvent
	| WorkflowPublishedEvent
	| AllStartedEvent
	| AllCompletedEvent
	| RaceStartedEvent
	| RaceCompletedEvent
	| WorkflowCompletedEvent
	| WorkflowFailedEvent
	| WorkflowCancelledEvent
	| LoopStartedEvent
	| LoopCompletedEvent;

// --- Trace envelope ---

export type WorkflowTrace = {
	schemaVersion: number;
	libraryVersion: string;
	workflowId: string;
	events: WorkflowEvent[];
};

// --- Workflow types ---

// Raw generator type for inner primitives (activity, query, sleep, etc.)
export type WorkflowGenerator<A, R extends Requirement = never> = Generator<
	Descriptor & Requires<R>,
	A,
	unknown
>;

// A workflow wraps a generator factory with combinators and yield* support.
// biome-ignore lint/suspicious/noExplicitAny: Generator protocol requires any for type-erased delegation
export class Workflow<A, R extends Requirement = never> {
	readonly __requirement?: R;
	private _factory: () => Generator<any, any, any>;

	constructor(factory: () => Generator<Descriptor & Requires<R>, A, unknown>) {
		this._factory = factory;
	}

	// Creates a fresh generator — used by the interpreter and registry
	createGenerator(): Generator<any, any, any> {
		return this._factory();
	}

	// Makes yield* work — delegates to a fresh generator
	*[Symbol.iterator](): Generator<Descriptor & Requires<R>, A, unknown> {
		return yield* this._factory();
	}

	map<B>(fn: (a: A) => B): Workflow<B, R> {
		return new Workflow(() => wrapMap(this._factory(), fn as any) as any);
	}

	// biome-ignore lint/suspicious/noExplicitAny: need any for provider generator matching
	provide<K extends string, G extends () => Generator<any, any, any>>(
		label: K,
		provider: G,
	): Workflow<A, Exclude<R, Query<K, any>> | Requirements<ReturnType<G>>> {
		return new Workflow(
			() => wrapProvide(this._factory(), label, provider) as any,
		);
	}
}

// Creates a Workflow from a generator function.
// biome-ignore lint/suspicious/noExplicitAny: accepts any generator, extracts A and R via conditional types
export function workflow<F extends () => Generator<any, any, unknown>>(
	fn: F,
): Workflow<
	F extends () => Generator<any, infer A, any> ? A : never,
	Requirements<ReturnType<F>>
> {
	return new Workflow(fn as any);
}

function* wrapMap(
	gen: Generator<any, any, unknown>,
	mapFn: (a: unknown) => unknown,
): Generator<any, any, unknown> {
	let input: unknown;
	let threw = false;
	let thrownValue: unknown;

	for (;;) {
		const next = threw ? gen.throw(thrownValue) : gen.next(input);
		threw = false;

		if (next.done) {
			return mapFn(next.value);
		}

		try {
			input = yield next.value;
		} catch (err) {
			threw = true;
			thrownValue = err;
		}
	}
}

function* wrapProvide(
	gen: Generator<any, any, unknown>,
	label: string,
	provider: () => Generator<any, any, any>,
): Generator<any, any, unknown> {
	let input: unknown;
	let threw = false;
	let thrownValue: unknown;

	for (;;) {
		const next = threw ? gen.throw(thrownValue) : gen.next(input);
		threw = false;

		if (next.done) {
			return next.value;
		}

		const descriptor = next.value as Descriptor;

		// Intercept query descriptors matching the label
		if (
			descriptor.type === "query" &&
			(descriptor as QueryDescriptor).label === label
		) {
			// Run the provider workflow inline via yield* delegation
			try {
				input = yield* provider();
			} catch (err) {
				threw = true;
				thrownValue = err;
			}
			continue;
		}

		try {
			input = yield next.value;
		} catch (err) {
			threw = true;
			thrownValue = err;
		}
	}
}

// --- Free functions (context-free workflow primitives) ---

export function activity<T>(
	name: string,
	fn: (signal: AbortSignal) => Promise<T>,
): Generator<ActivityDescriptor & Requires<never>, T, unknown> {
	return (function* () {
		const result = yield {
			type: "activity" as const,
			name,
			fn,
		} as ActivityDescriptor & Requires<never>;
		return result as T;
	})();
}

// --- handler: multi-signal loop builder ---

// Builder type that accumulates Query requirements via .on() calls
export type SignalReceiver<Reqs extends Requirement = never> = {
	// biome-ignore lint/suspicious/noExplicitAny: handler bodies can yield any command
	on: <K extends string, V, G extends Generator<any, void, any>>(
		signal: K,
		fn: (payload: V, done: <D>(value: D) => WorkflowGenerator<never>) => G,
	) => SignalReceiver<Reqs | Query<K, V> | Req<G>>;
	as: <T>() => WorkflowGenerator<T, Reqs>;
};

export function handler(): SignalReceiver {
	// biome-ignore lint/suspicious/noExplicitAny: internal handler storage
	const handlers: Array<{
		signal: string;
		fn: (...args: any[]) => Generator<any, void, any>;
	}> = [];
	const builder: SignalReceiver = {
		on(sig, fn) {
			handlers.push({ signal: sig, fn: fn as any });
			return builder as any;
		},
		as() {
			const doneFn = <D>(value: D): WorkflowGenerator<never> =>
				loopBreak(value) as WorkflowGenerator<never>;
			return loop(function* () {
				const result = yield* race(
					...handlers.map((h) => query(h.signal)),
				) as Generator<any, { winner: number; value: unknown }, unknown>;
				const h = handlers[result.winner];
				if (h) {
					yield* h.fn(result.value, doneFn);
				}
			}) as any;
		},
	};
	return builder;
}

export function sleep(
	durationMs: number,
): Generator<SleepDescriptor & Requires<never>, void, unknown> {
	return (function* () {
		yield { type: "sleep" as const, durationMs } as SleepDescriptor &
			Requires<never>;
	})();
}

export function child<W extends Workflow<any, any>>(
	name: string,
	wf: W,
): Generator<
	ChildDescriptor & Requires<Requirements<W>>,
	WorkflowReturn<W>,
	unknown
> {
	return (function* () {
		const result = yield {
			type: "child" as const,
			name,
			workflow: wf,
		} as ChildDescriptor & Requires<Requirements<W>>;
		return result as WorkflowReturn<W>;
	})();
}

export function publish<V>(
	value: V,
): Generator<PublishDescriptor & Requires<Publishes<V>>, void, unknown> {
	return (function* () {
		yield { type: "publish" as const, value } as PublishDescriptor &
			Requires<Publishes<V>>;
	})();
}

export function query<V, K extends string = string>(
	label: K,
): Generator<QueryDescriptor & Requires<Query<K, V>>, V, unknown> & {
	as: <W>() => Generator<QueryDescriptor & Requires<Query<K, W>>, W, unknown>;
} {
	const gen = (function* (): Generator<
		QueryDescriptor & Requires<Query<K, V>>,
		V,
		unknown
	> {
		const result = yield {
			type: "query" as const,
			label,
		} as QueryDescriptor & Requires<Query<K, V>>;
		return result as V;
	})();
	(gen as any).as = <W>() => query<W, K>(label);
	return gen as any;
}

// Extracts requirements from a generator's yield type
type Req<G> =
	G extends Generator<infer Y, any, any>
		? Y extends { __requirement?: infer R }
			? R extends Requirement
				? R
				: never
			: never
		: never;

// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race<
	A extends Generator<any, any, any>,
	B extends Generator<any, any, any>,
>(
	a: A,
	b: B,
): Generator<
	RaceDescriptor & Requires<Req<A> | Req<B>>,
	RaceResult<
		[
			A extends Generator<any, infer RA, any> ? RA : never,
			B extends Generator<any, infer RB, any> ? RB : never,
		]
	>,
	unknown
>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race<
	A extends Generator<any, any, any>,
	B extends Generator<any, any, any>,
	C extends Generator<any, any, any>,
>(
	a: A,
	b: B,
	c: C,
): Generator<
	RaceDescriptor & Requires<Req<A> | Req<B> | Req<C>>,
	RaceResult<
		[
			A extends Generator<any, infer RA, any> ? RA : never,
			B extends Generator<any, infer RB, any> ? RB : never,
			C extends Generator<any, infer RC, any> ? RC : never,
		]
	>,
	unknown
>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race(
	...branches: Generator<any, unknown, any>[]
): Generator<
	RaceDescriptor & Requires<Requirement>,
	{ winner: number; value: unknown },
	unknown
>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race(
	...branches: Generator<any, unknown, any>[]
): Generator<
	RaceDescriptor & Requires<Requirement>,
	{ winner: number; value: unknown },
	unknown
> {
	const items: Descriptor[] = branches.map((gen) => {
		const result = gen.next();
		if (result.done) throw new Error("Race branch yielded no command");
		return result.value as Descriptor;
	});
	return (function* () {
		const result = yield { type: "race" as const, items } as RaceDescriptor &
			Requires<Requirement>;
		return result as { winner: number; value: unknown };
	})();
}

// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all<
	A extends Generator<any, any, any>,
	B extends Generator<any, any, any>,
>(
	a: A,
	b: B,
): Generator<
	AllDescriptor & Requires<Req<A> | Req<B>>,
	[
		A extends Generator<any, infer RA, any> ? RA : never,
		B extends Generator<any, infer RB, any> ? RB : never,
	],
	unknown
>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all<
	A extends Generator<any, any, any>,
	B extends Generator<any, any, any>,
	C extends Generator<any, any, any>,
>(
	a: A,
	b: B,
	c: C,
): Generator<
	AllDescriptor & Requires<Req<A> | Req<B> | Req<C>>,
	[
		A extends Generator<any, infer RA, any> ? RA : never,
		B extends Generator<any, infer RB, any> ? RB : never,
		C extends Generator<any, infer RC, any> ? RC : never,
	],
	unknown
>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all<
	A extends Generator<any, any, any>,
	B extends Generator<any, any, any>,
	C extends Generator<any, any, any>,
	D extends Generator<any, any, any>,
>(
	a: A,
	b: B,
	c: C,
	d: D,
): Generator<
	AllDescriptor & Requires<Req<A> | Req<B> | Req<C> | Req<D>>,
	[
		A extends Generator<any, infer RA, any> ? RA : never,
		B extends Generator<any, infer RB, any> ? RB : never,
		C extends Generator<any, infer RC, any> ? RC : never,
		D extends Generator<any, infer RD, any> ? RD : never,
	],
	unknown
>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all(
	...branches: Generator<any, unknown, any>[]
): Generator<AllDescriptor & Requires<Requirement>, unknown[], unknown>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all(
	...branches: Generator<any, unknown, any>[]
): Generator<AllDescriptor & Requires<Requirement>, unknown[], unknown> {
	const items: Descriptor[] = branches.map((gen) => {
		const result = gen.next();
		if (result.done) throw new Error("All branch yielded no command");
		return result.value as Descriptor;
	});
	return (function* () {
		const result = yield { type: "all" as const, items } as AllDescriptor &
			Requires<Requirement>;
		return result as unknown[];
	})();
}

// Extracts the break value type from a loop body's yield type
type LoopBreakValue<Y> = Y extends LoopBreakDescriptor<infer V> ? V : never;

// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
export function loop<F extends () => Generator<any, void, any>>(
	body: F,
): Generator<
	LoopDescriptor & Requires<Exclude<Req<ReturnType<F>>, never>>,
	LoopBreakValue<YieldOf<ReturnType<F>>>,
	unknown
> {
	return (function* () {
		const result = yield {
			type: "loop" as const,
			body,
		} as LoopDescriptor & Requires<Exclude<Req<ReturnType<F>>, never>>;
		return result as LoopBreakValue<YieldOf<ReturnType<F>>>;
	})();
}

export function loopBreak<V>(
	value: V,
): Generator<LoopBreakDescriptor<V> & Requires<never>, never, unknown> {
	return (function* (): Generator<
		LoopBreakDescriptor<V> & Requires<never>,
		never,
		unknown
	> {
		yield { type: "loop_break" as const, value } as LoopBreakDescriptor<V> &
			Requires<never>;
		// The interpreter will intercept this — control never returns here
		throw new Error("loopBreak must be used inside a loop");
	})();
}

// Helper to extract yield type from a generator
// biome-ignore lint/suspicious/noExplicitAny: need any for generator matching
type YieldOf<G> = G extends Generator<infer Y, any, any> ? Y : never;

// Type-erased Workflow for registry storage and other untyped boundaries.
// biome-ignore lint/suspicious/noExplicitAny: type-erased boundary for registry storage
export type AnyWorkflow = Workflow<any, any>;

// --- Workflow state (tagged union) ---

export const RUNNING = "running" as const;
export const WAITING = "waiting" as const;
export const COMPLETED = "completed" as const;
export const FAILED = "failed" as const;
export const CANCELLED = "cancelled" as const;

// Internal status string used by the interpreter.
export type InterpreterStatus =
	| typeof RUNNING
	| typeof WAITING
	| typeof COMPLETED
	| typeof FAILED
	| typeof CANCELLED;

// Public workflow state exposed to consumers via useWorkflow and snapshots.
export type WorkflowState<T = unknown> =
	| { status: typeof RUNNING }
	| { status: typeof WAITING }
	| { status: typeof COMPLETED; result: T }
	| { status: typeof FAILED; error: string }
	| { status: typeof CANCELLED };

// --- Registry interface (avoids circular imports) ---

export type WorkflowRegistryInterface = {
	has(workflowId: string): boolean;
	waitFor<T>(
		workflowId: string,
		options?: { start?: boolean; caller?: string },
	): Promise<T>;
	start(workflowId: string): Promise<void>;
	publish(workflowId: string, value: unknown): void;
	getPublishSeq(workflowId: string): number;
};

// --- Observers ---

export type WorkflowEventObserver = (
	workflowId: string,
	event: WorkflowEvent,
) => void;

// --- Storage ---

export type WorkflowStorage = {
	load(workflowId: string): Promise<WorkflowEvent[]>;
	append(workflowId: string, events: WorkflowEvent[]): Promise<void>;
	compact(workflowId: string, events: WorkflowEvent[]): Promise<void>;
	clear(workflowId: string): Promise<void>;
	loadVersion?(workflowId: string): Promise<number | undefined>;
	saveVersion?(workflowId: string, version: number): Promise<void>;
};

// --- Event log snapshot ---

export type WorkflowEventLog = {
	id: string;
	events: WorkflowEvent[];
};

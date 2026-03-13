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

// Declares that a workflow receives signal K with payload V
export type Signal<K extends string = string, V = unknown> = {
	readonly _tag: "signal";
	readonly signal: { readonly [P in K]: V };
};

// Declares that a workflow depends on the result of workflow K (via join)
export type Result<K extends string = string, V = unknown> = {
	readonly _tag: "result";
	readonly result: { readonly [P in K]: V };
};

// Declares that a workflow depends on a published value V from workflow K
export type Published<K extends string = string, V = unknown> = {
	readonly _tag: "published";
	readonly published: { readonly [P in K]: V };
};

// Declares that a workflow publishes values of type V
export type Publishes<V = unknown> = {
	readonly _tag: "publishes";
	readonly publishes: V;
};

// Union of all requirement tags
export type Requirement = Signal | Result | Published | Publishes;

// --- Step (internal yield carrier) ---

// Branded type that carries a requirement through the generator's Yield parameter.
// Users never reference this directly — they just yield* it.
// At runtime, the yielded value is a Command object; Step's fields are phantom.
export type Step<R extends Requirement = never> = {
	readonly __requirement?: R;
	readonly __step?: true;
};

// --- Requirements (extractor) ---

// Extracts the accumulated requirements from a Workflow or Step.
// Reads the phantom __requirement field from the yield type, filtering
// through Requirement to strip undefined (from optional fields with never).
export type Requirements<W> =
	W extends Generator<infer Y, unknown, unknown>
		? Y extends { __requirement?: infer R }
			? R extends Requirement ? R : never
			: never
		: W extends Step<infer R> ? R
		: never;

// Extracts a signal map { name: payload } from a workflow function's requirements.
// Filters to Signal requirements and builds a record from their key-value pairs.
export type SignalMap<W> =
	Requirements<W> extends infer R
		? R extends Signal<infer K, infer V>
			? { readonly [P in K]: V }
			: never
		: never;

// Merges a union of single-key records into one record.
// e.g. { profile: UserProfile } | { payment: PaymentInfo } → { profile: UserProfile; payment: PaymentInfo }
// biome-ignore lint/complexity/noBannedTypes: {} is the identity element for intersection accumulation
type UnionToIntersection<U> = (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void ? I : never;
export type SignalMapOf<F> = F extends (...args: any[]) => infer G
	? [SignalMap<G>] extends [never] ? Record<string, never> : UnionToIntersection<SignalMap<G>>
	: Record<string, never>;

// --- Dependency checking utilities ---

// Extracts the return type from a workflow function
// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
export type WorkflowReturn<F> = F extends (...args: any[]) => Generator<any, infer T, any> ? T : never;

// Extracts the Publishes<V> value type from a requirement union
export type ExtractPublishes<R> = R extends Publishes<infer V> ? V : never;

// Extracts requirements from a workflow function
// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
export type ReqsOf<F> = F extends (...args: any[]) => Generator<any, any, any>
	? Requirements<ReturnType<F>>
	: never;

// Extracts Result dependency keys from a requirement union
export type ResultDeps<R> = R extends Result<infer K, any> ? K : never;

// Extracts Published dependency keys from a requirement union
export type PublishedDeps<R> = R extends Published<infer K, any> ? K : never;

// All dependency keys (Result + Published) from a requirement union
export type DepKeys<R> = ResultDeps<R> | PublishedDeps<R>;

// Dependency keys from R that are NOT satisfied by Provides
export type UnsatisfiedDeps<R, Provides extends Record<string, unknown>> =
	Exclude<DepKeys<R>, keyof Provides>;

// Resolves to F if all deps are satisfied, otherwise a descriptive error string
export type CheckDeps<F, Provides extends Record<string, unknown>> =
	[UnsatisfiedDeps<ReqsOf<F>, Provides>] extends [never]
		? F
		: `Missing dependencies: ${UnsatisfiedDeps<ReqsOf<F>, Provides> & string}`;

// --- Descriptors (yielded by workflow generators, no seq) ---

export type ActivityDescriptor = {
	type: "activity";
	name: string;
	fn: (signal: AbortSignal) => Promise<unknown>;
};

export type ReceiveDescriptor = {
	type: "receive";
	signal: string;
};

export type SleepDescriptor = {
	type: "sleep";
	durationMs: number;
};

export type ChildDescriptor = {
	type: "child";
	name: string;
	workflow: AnyWorkflowFunction;
};

export type PublishedDescriptor = {
	type: "published";
	workflowId: string;
	start: boolean;
	where?: (value: unknown) => boolean;
	afterSeq?: number;
};

export type JoinDescriptor = {
	type: "join";
	workflowId: string;
	start: boolean;
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

export type SubscribeDescriptor = {
	type: "subscribe";
	workflowId: string;
	start: boolean;
	where?: (value: unknown) => boolean;
	body: (
		value: unknown,
		done: <T>(value: T) => Workflow<never>,
	) => Workflow<void, Requirement>;
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
	| ReceiveDescriptor
	| SleepDescriptor
	| ChildDescriptor
	| PublishedDescriptor
	| JoinDescriptor
	| RaceDescriptor
	| AllDescriptor
	| PublishDescriptor
	| SubscribeDescriptor
	| LoopDescriptor
	| LoopBreakDescriptor;

// --- Commands (descriptors with seq, internal to interpreter) ---

export type ActivityCommand = ActivityDescriptor & { seq: number };
export type ReceiveCommand = ReceiveDescriptor & { seq: number };
export type SleepCommand = SleepDescriptor & { seq: number };
export type ChildCommand = ChildDescriptor & { seq: number };
export type PublishedCommand = PublishedDescriptor & { seq: number };
export type JoinCommand = JoinDescriptor & { seq: number };
export type PublishCommand = PublishDescriptor & { seq: number };
export type RaceCommand = { type: "race"; items: Command[]; seq: number };
export type AllCommand = { type: "all"; items: Command[]; seq: number };
export type SubscribeCommand = SubscribeDescriptor & { seq: number };

export type LoopCommand = LoopDescriptor & { seq: number };
export type LoopBreakCommand = LoopBreakDescriptor & { seq: number };

export type Command =
	| ActivityCommand
	| ReceiveCommand
	| SleepCommand
	| ChildCommand
	| PublishedCommand
	| JoinCommand
	| RaceCommand
	| AllCommand
	| PublishCommand
	| SubscribeCommand
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

export type SignalReceivedEvent = {
	type: "signal_received";
	signal: string;
	payload: unknown;
	seq: number;
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

export type WorkflowDependencyStartedEvent = {
	type: "workflow_dependency_started";
	workflowId: string;
	seq: number;
	timestamp: number;
};

export type WorkflowDependencyCompletedEvent = {
	type: "workflow_dependency_completed";
	workflowId: string;
	seq: number;
	result: unknown;
	timestamp: number;
};

export type WorkflowDependencyPublishedEvent = {
	type: "workflow_dependency_published";
	workflowId: string;
	seq: number;
	result: unknown;
	timestamp: number;
};

export type WorkflowDependencyFailedEvent = {
	type: "workflow_dependency_failed";
	workflowId: string;
	seq: number;
	error: string;
	stack?: string;
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
	| SignalReceivedEvent
	| TimerStartedEvent
	| TimerFiredEvent
	| ChildStartedEvent
	| ChildCompletedEvent
	| ChildFailedEvent
	| WorkflowDependencyStartedEvent
	| WorkflowDependencyCompletedEvent
	| WorkflowDependencyPublishedEvent
	| WorkflowDependencyFailedEvent
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

// --- WorkflowMap constraint helpers ---

export type WorkflowDep = { published?: unknown; result?: unknown };

export type PublishedOf<
	M extends Record<string, WorkflowDep>,
	K extends keyof M,
> = M[K] extends { published: infer P } ? P : never;

export type ResultOf<
	M extends Record<string, WorkflowDep>,
	K extends keyof M,
> = M[K] extends { result: infer R } ? R : never;

// --- Workflow types ---

export type Workflow<A, R extends Requirement = never> = Generator<Descriptor & Step<R>, A, unknown>;

// Wraps a generator function into a workflow with inferred requirements.
// At runtime, this is the identity function — the magic is at the type level,
// where TypeScript infers R from all yield* calls in the body.
// biome-ignore lint/suspicious/noExplicitAny: preserves the full function type including parameter types
export function workflow<F extends (...args: any[]) => Generator<any, any, unknown>>(
	fn: F,
): F {
	return fn;
}

// --- Free functions (context-free workflow primitives) ---

export function activity<T>(
	name: string,
	fn: (signal: AbortSignal) => Promise<T>,
): Generator<ActivityDescriptor & Step<never>, T, unknown> {
	return (function* () {
		const result = yield { type: "activity" as const, name, fn } as ActivityDescriptor & Step<never>;
		return result as T;
	})();
}

// --- receive: primitive signal-waiting command ---

export function receive<V, K extends string = string>(
	signal: K,
): Generator<ReceiveDescriptor & Step<Signal<K, V>>, V, unknown> & {
	as: <W>() => Generator<ReceiveDescriptor & Step<Signal<K, W>>, W, unknown>;
} {
	const gen = (function* (): Generator<ReceiveDescriptor & Step<Signal<string, unknown>>, unknown, unknown> {
		const result = yield { type: "receive" as const, signal } as ReceiveDescriptor & Step<Signal<string, unknown>>;
		return result;
	})();
	(gen as any).as = <W>() => receive<W>(signal);
	return gen as any;
}

// --- handler: multi-signal loop builder ---

// Builder type that accumulates Signal requirements via .on() calls
export type SignalReceiver<Reqs extends Requirement = never> = {
	on: <K extends string, V>(
		signal: K,
		// biome-ignore lint/suspicious/noExplicitAny: handler bodies can yield any command
		fn: (payload: V, done: <D>(value: D) => Workflow<never>) => Generator<any, void, any>,
	) => SignalReceiver<Reqs | Signal<K, V>>;
	as: <T>() => Workflow<T, Reqs>;
};

export function handler(): SignalReceiver {
	// biome-ignore lint/suspicious/noExplicitAny: internal handler storage
	const handlers: Array<{ signal: string; fn: (...args: any[]) => Generator<any, void, any> }> = [];
	const builder: SignalReceiver = {
		on(sig, fn) {
			handlers.push({ signal: sig, fn: fn as any });
			return builder as any;
		},
		as() {
			const doneFn = <D>(value: D): Workflow<never> => loopBreak(value) as Workflow<never>;
			return loop(function* () {
				const result = yield* (race(
					...handlers.map((h) => receive(h.signal)),
				) as Generator<any, { winner: number; value: unknown }, unknown>);
				const h = handlers[result.winner];
				if (h) {
					yield* h.fn(result.value, doneFn);
				}
			}) as any;
		},
	};
	return builder;
}

export function sleep(durationMs: number): Generator<SleepDescriptor & Step<never>, void, unknown> {
	return (function* () {
		yield { type: "sleep" as const, durationMs } as SleepDescriptor & Step<never>;
	})();
}

export function child<T>(
	name: string,
	workflowFn: AnyWorkflowFunction,
): Generator<ChildDescriptor & Step<never>, T, unknown> {
	return (function* () {
		const result = yield {
			type: "child" as const,
			name,
			workflow: workflowFn,
		} as ChildDescriptor & Step<never>;
		return result as T;
	})();
}

export function publish<V>(value: V): Generator<PublishDescriptor & Step<Publishes<V>>, void, unknown> {
	return (function* () {
		yield { type: "publish" as const, value } as PublishDescriptor & Step<Publishes<V>>;
	})();
}

export function published<V, K extends string = string>(
	workflowId: K,
	options?: { start?: boolean; where?: (value: V) => boolean; afterSeq?: number },
): Generator<PublishedDescriptor & Step<Published<K, V>>, V, unknown> & {
	as: <W>() => Generator<PublishedDescriptor & Step<Published<K, W>>, W, unknown>;
} {
	const start = options?.start ?? true;
	const gen = (function* (): Generator<PublishedDescriptor & Step<Published<K, V>>, V, unknown> {
		const result = yield {
			type: "published" as const,
			workflowId,
			start,
			where: options?.where as ((value: unknown) => boolean) | undefined,
			afterSeq: options?.afterSeq,
		} as PublishedDescriptor & Step<Published<K, V>>;
		return result as V;
	})();
	(gen as any).as = <W>() => published<W, K>(workflowId, options as any);
	return gen as any;
}

export function join<V, K extends string = string>(
	workflowId: K,
	options?: { start?: boolean },
): Generator<JoinDescriptor & Step<Result<K, V>>, V, unknown> & {
	as: <W>() => Generator<JoinDescriptor & Step<Result<K, W>>, W, unknown>;
} {
	const start = options?.start ?? true;
	const gen = (function* (): Generator<JoinDescriptor & Step<Result<K, V>>, V, unknown> {
		const result = yield {
			type: "join" as const,
			workflowId,
			start,
		} as JoinDescriptor & Step<Result<K, V>>;
		return result as V;
	})();
	(gen as any).as = <W>() => join<W, K>(workflowId, options);
	return gen as any;
}

// Extracts requirements from a generator's yield type
type Req<G> = G extends Generator<infer Y, any, any>
	? Y extends { __requirement?: infer R } ? R extends Requirement ? R : never : never
	: never;

// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race<A extends Generator<any, any, any>, B extends Generator<any, any, any>>(a: A, b: B): Generator<RaceDescriptor & Step<Req<A> | Req<B>>, RaceResult<[A extends Generator<any, infer RA, any> ? RA : never, B extends Generator<any, infer RB, any> ? RB : never]>, unknown>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race<A extends Generator<any, any, any>, B extends Generator<any, any, any>, C extends Generator<any, any, any>>(a: A, b: B, c: C): Generator<RaceDescriptor & Step<Req<A> | Req<B> | Req<C>>, RaceResult<[A extends Generator<any, infer RA, any> ? RA : never, B extends Generator<any, infer RB, any> ? RB : never, C extends Generator<any, infer RC, any> ? RC : never]>, unknown>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race(...branches: Generator<any, unknown, any>[]): Generator<RaceDescriptor & Step<Requirement>, { winner: number; value: unknown }, unknown>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race(...branches: Generator<any, unknown, any>[]): Generator<RaceDescriptor & Step<Requirement>, { winner: number; value: unknown }, unknown> {
	const items: Descriptor[] = branches.map((gen) => {
		const result = gen.next();
		if (result.done) throw new Error("Race branch yielded no command");
		return result.value as Descriptor;
	});
	return (function* () {
		const result = yield { type: "race" as const, items } as RaceDescriptor & Step<Requirement>;
		return result as { winner: number; value: unknown };
	})();
}

// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all<A extends Generator<any, any, any>, B extends Generator<any, any, any>>(a: A, b: B): Generator<AllDescriptor & Step<Req<A> | Req<B>>, [A extends Generator<any, infer RA, any> ? RA : never, B extends Generator<any, infer RB, any> ? RB : never], unknown>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all<A extends Generator<any, any, any>, B extends Generator<any, any, any>, C extends Generator<any, any, any>>(a: A, b: B, c: C): Generator<AllDescriptor & Step<Req<A> | Req<B> | Req<C>>, [A extends Generator<any, infer RA, any> ? RA : never, B extends Generator<any, infer RB, any> ? RB : never, C extends Generator<any, infer RC, any> ? RC : never], unknown>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all<A extends Generator<any, any, any>, B extends Generator<any, any, any>, C extends Generator<any, any, any>, D extends Generator<any, any, any>>(a: A, b: B, c: C, d: D): Generator<AllDescriptor & Step<Req<A> | Req<B> | Req<C> | Req<D>>, [A extends Generator<any, infer RA, any> ? RA : never, B extends Generator<any, infer RB, any> ? RB : never, C extends Generator<any, infer RC, any> ? RC : never, D extends Generator<any, infer RD, any> ? RD : never], unknown>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all(...branches: Generator<any, unknown, any>[]): Generator<AllDescriptor & Step<Requirement>, unknown[], unknown>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all(...branches: Generator<any, unknown, any>[]): Generator<AllDescriptor & Step<Requirement>, unknown[], unknown> {
	const items: Descriptor[] = branches.map((gen) => {
		const result = gen.next();
		if (result.done) throw new Error("All branch yielded no command");
		return result.value as Descriptor;
	});
	return (function* () {
		const result = yield { type: "all" as const, items } as AllDescriptor & Step<Requirement>;
		return result as unknown[];
	})();
}

export function subscribe<T, V, K extends string = string>(
	workflowId: K,
	options: { start?: boolean; where?: (value: V) => boolean },
	body: (
		value: V,
		done: <D>(value: D) => Workflow<never>,
	) => Workflow<void, Signal | Publishes>,
): Generator<SubscribeDescriptor & Step<Published<K, V>>, T, unknown> {
	const start = options?.start ?? true;
	return (function* () {
		const result = yield {
			type: "subscribe" as const,
			workflowId,
			start,
			where: options?.where as ((value: unknown) => boolean) | undefined,
			body: body as SubscribeDescriptor["body"],
		} as SubscribeDescriptor & Step<Published<K, V>>;
		return result as T;
	})();
}

// Extracts the break value type from a loop body's yield type
type LoopBreakValue<Y> = Y extends LoopBreakDescriptor<infer V> ? V : never;

// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
export function loop<F extends () => Generator<any, void, any>>(
	body: F,
): Generator<
	LoopDescriptor & Step<Exclude<Req<ReturnType<F>>, never>>,
	LoopBreakValue<YieldOf<ReturnType<F>>>,
	unknown
> {
	return (function* () {
		const result = yield {
			type: "loop" as const,
			body,
		} as LoopDescriptor & Step<Exclude<Req<ReturnType<F>>, never>>;
		return result as LoopBreakValue<YieldOf<ReturnType<F>>>;
	})();
}

export function loopBreak<V>(value: V): Generator<LoopBreakDescriptor<V> & Step<never>, never, unknown> {
	return (function* (): Generator<LoopBreakDescriptor<V> & Step<never>, never, unknown> {
		yield { type: "loop_break" as const, value } as LoopBreakDescriptor<V> & Step<never>;
		// The interpreter will intercept this — control never returns here
		throw new Error("loopBreak must be used inside a loop");
	})();
}

// Helper to extract yield type from a generator
// biome-ignore lint/suspicious/noExplicitAny: need any for generator matching
type YieldOf<G> = G extends Generator<infer Y, any, any> ? Y : never;

// Sentinel thrown by done() callbacks inside subscribe to exit the loop.
export class DoneSignal {
	constructor(public readonly value: unknown) {}
}

// A signal handler function that receives a typed payload
export type SignalHandler<V = unknown> = (
	payload: V,
	done: <T>(value: T) => Workflow<never>,
	// biome-ignore lint/suspicious/noExplicitAny: handler bodies can yield any command
) => Generator<any, void, any>;


// Accepts any workflow function regardless of parameter or return types.
// biome-ignore lint/suspicious/noExplicitAny: type-erased boundary for registry storage
export type AnyWorkflowFunction = (...args: any[]) => Generator<any, any, any>;

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
	waitForPublished<T>(
		workflowId: string,
		options?: {
			start?: boolean;
			caller?: string;
			where?: (value: unknown) => boolean;
			afterSeq?: number;
		},
	): Promise<T>;
	waitForCompletion<T>(
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

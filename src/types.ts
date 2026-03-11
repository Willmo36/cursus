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
	| SubscribeDescriptor;

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
	| SubscribeCommand;

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
	| WorkflowCancelledEvent;

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
): Workflow<T> {
	return (function* () {
		const result = yield { type: "activity" as const, name, fn } as Descriptor & Step<never>;
		return result as T;
	})();
}

export function receive<V, K extends string = string>(
	signal: K,
): Workflow<V, Signal<K, V>> {
	return (function* () {
		const result = yield { type: "receive" as const, signal } as Descriptor & Step<Signal<K, V>>;
		return result as V;
	})();
}

export function sleep(durationMs: number): Workflow<void> {
	return (function* () {
		yield { type: "sleep" as const, durationMs } as Descriptor & Step<never>;
	})();
}

export function child<T>(
	name: string,
	workflowFn: AnyWorkflowFunction,
): Workflow<T> {
	return (function* () {
		const result = yield {
			type: "child" as const,
			name,
			workflow: workflowFn,
		} as Descriptor & Step<never>;
		return result as T;
	})();
}

export function publish<V>(value: V): Workflow<void, Publishes<V>> {
	return (function* () {
		yield { type: "publish" as const, value } as Descriptor & Step<Publishes<V>>;
	})();
}

export function published<V, K extends string = string>(
	workflowId: K,
	options?: { start?: boolean; where?: (value: V) => boolean; afterSeq?: number },
): Workflow<V, Dependency<K, V>> {
	const start = options?.start ?? true;
	return (function* () {
		const result = yield {
			type: "published" as const,
			workflowId,
			start,
			where: options?.where as ((value: unknown) => boolean) | undefined,
			afterSeq: options?.afterSeq,
		} as Descriptor & Step<Dependency<K, V>>;
		return result as V;
	})();
}

export function join<V, K extends string = string>(
	workflowId: K,
	options?: { start?: boolean },
): Workflow<V, Dependency<K, V>> {
	const start = options?.start ?? true;
	return (function* () {
		const result = yield {
			type: "join" as const,
			workflowId,
			start,
		} as Descriptor & Step<Dependency<K, V>>;
		return result as V;
	})();
}

// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race<A, B>(a: Workflow<A, any>, b: Workflow<B, any>): Workflow<RaceResult<[A, B]>, Requirement>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race<A, B, C>(a: Workflow<A, any>, b: Workflow<B, any>, c: Workflow<C, any>): Workflow<RaceResult<[A, B, C]>, Requirement>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race(...branches: Workflow<unknown, any>[]): Workflow<{ winner: number; value: unknown }, Requirement>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function race(...branches: Workflow<unknown, any>[]): Workflow<{ winner: number; value: unknown }, Requirement> {
	const items: Descriptor[] = branches.map((gen) => {
		const result = gen.next();
		if (result.done) throw new Error("Race branch yielded no command");
		return result.value as Descriptor;
	});
	return (function* () {
		const result = yield { type: "race" as const, items } as Descriptor & Step<Requirement>;
		return result as { winner: number; value: unknown };
	})();
}

// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all<A, B>(a: Workflow<A, any>, b: Workflow<B, any>): Workflow<[A, B], Requirement>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all<A, B, C>(a: Workflow<A, any>, b: Workflow<B, any>, c: Workflow<C, any>): Workflow<[A, B, C], Requirement>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all<A, B, C, D>(a: Workflow<A, any>, b: Workflow<B, any>, c: Workflow<C, any>, d: Workflow<D, any>): Workflow<[A, B, C, D], Requirement>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all(...branches: Workflow<unknown, any>[]): Workflow<unknown[], Requirement>;
// biome-ignore lint/suspicious/noExplicitAny: variadic overloads require any for branch type inference
export function all(...branches: Workflow<unknown, any>[]): Workflow<unknown[], Requirement> {
	const items: Descriptor[] = branches.map((gen) => {
		const result = gen.next();
		if (result.done) throw new Error("All branch yielded no command");
		return result.value as Descriptor;
	});
	return (function* () {
		const result = yield { type: "all" as const, items } as Descriptor & Step<Requirement>;
		return result as unknown[];
	})();
}

export function subscribe<T, V, K extends string = string>(
	workflowId: K,
	options: { start?: boolean; where?: (value: V) => boolean },
	body: (
		value: V,
		done: <D>(value: D) => Workflow<never>,
	) => Workflow<void, Requirement>,
): Workflow<T, Dependency<K, V>> {
	const start = options?.start ?? true;
	return (function* () {
		const result = yield {
			type: "subscribe" as const,
			workflowId,
			start,
			where: options?.where as ((value: unknown) => boolean) | undefined,
			body: body as SubscribeDescriptor["body"],
		} as Descriptor & Step<Dependency<K, V>>;
		return result as T;
	})();
}

// Sentinel thrown by done() callbacks inside handle/subscribe to exit the loop.
export class DoneSignal {
	constructor(public readonly value: unknown) {}
}

export type SignalHandler = (
	payload: unknown,
	done: <T>(value: T) => Workflow<never>,
) => Workflow<void, Requirement>;

export function handle<T>(
	handlers: Record<string, SignalHandler>,
): Workflow<T, Requirement> {
	const handlerNames = Object.keys(handlers);
	const doneFn = <D>(value: D): Workflow<never> => {
		return (function* (): Generator<Descriptor, never, unknown> {
			throw new DoneSignal(value);
		})();
	};
	return (function* (): Generator<Descriptor, T, unknown> {
		for (;;) {
			const result = yield* race(
				...handlerNames.map((n) => receive(n)),
			);
			const signal = handlerNames[result.winner];
			const handler = handlers[signal];
			if (!handler) continue;
			try {
				yield* handler(result.value, doneFn);
			} catch (err) {
				if (err instanceof DoneSignal) {
					return err.value as T;
				}
				throw err;
			}
		}
	})();
}

// Accepts any workflow function regardless of its result type, signal map, or workflow map.
// Uses `any` to bypass contravariance — safe because the registry
// only forwards the context it constructs, never reads SignalMap/WorkflowMap directly.
// biome-ignore lint/suspicious/noExplicitAny: type-erased boundary for registry storage
export type AnyWorkflowFunction = (ctx: any) => Generator<any, any, any>;

export type WorkflowState =
	| "running"
	| "waiting"
	| "completed"
	| "failed"
	| "cancelled";

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

// --- Context (provided to workflow generators) ---

export type SignalHandlers<
	SignalMap extends Record<string, unknown>,
	WorkflowMap extends Record<string, unknown>,
	PublishType = never,
> = {
	[K in keyof SignalMap & string]?: (
		ctx: WorkflowContext<SignalMap, WorkflowMap, PublishType>,
		payload: SignalMap[K],
		done: <T>(value: T) => Workflow<never>,
	) => Workflow<void, Requirement>;
};

export type WorkflowContext<
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
	WorkflowMap extends Record<string, unknown> = Record<string, never>,
	PublishType = never,
> = {
	activity: <T>(
		name: string,
		fn: (signal: AbortSignal) => Promise<T>,
	) => Workflow<T>;
	receive: <K extends keyof SignalMap & string>(
		signal: K,
	) => Workflow<SignalMap[K], Signal<K, SignalMap[K]>>;
	handle: <T>(
		handlers: SignalHandlers<SignalMap, WorkflowMap, PublishType>,
	) => Workflow<T, Requirement>;
	sleep: (durationMs: number) => Workflow<void>;
	child: <T>(
		name: string,
		workflow: AnyWorkflowFunction,
	) => Workflow<T>;
	all: {
		<A, B>(
			a: Workflow<A, Requirement>,
			b: Workflow<B, Requirement>,
		): Workflow<[A, B], Requirement>;
		<A, B, C>(
			a: Workflow<A, Requirement>,
			b: Workflow<B, Requirement>,
			c: Workflow<C, Requirement>,
		): Workflow<[A, B, C], Requirement>;
		<A, B, C, D>(
			a: Workflow<A, Requirement>,
			b: Workflow<B, Requirement>,
			c: Workflow<C, Requirement>,
			d: Workflow<D, Requirement>,
		): Workflow<[A, B, C, D], Requirement>;
		(
			...branches: Workflow<unknown, Requirement>[]
		): Workflow<unknown[], Requirement>;
	};
	race: {
		<A, B>(
			a: Workflow<A, Requirement>,
			b: Workflow<B, Requirement>,
		): Workflow<RaceResult<[A, B]>, Requirement>;
		<A, B, C>(
			a: Workflow<A, Requirement>,
			b: Workflow<B, Requirement>,
			c: Workflow<C, Requirement>,
		): Workflow<RaceResult<[A, B, C]>, Requirement>;
		<A, B, C, D>(
			a: Workflow<A, Requirement>,
			b: Workflow<B, Requirement>,
			c: Workflow<C, Requirement>,
			d: Workflow<D, Requirement>,
		): Workflow<RaceResult<[A, B, C, D]>, Requirement>;
		(
			...branches: Workflow<unknown, Requirement>[]
		): Workflow<{ winner: number; value: unknown }, Requirement>;
	};
	published: {
		<K extends keyof WorkflowMap & string, S extends WorkflowMap[K]>(
			workflowId: K,
			options: { start?: boolean; where: (value: WorkflowMap[K]) => value is S; afterSeq?: number },
		): Workflow<S, Dependency<K, WorkflowMap[K]>>;
		<K extends keyof WorkflowMap & string>(
			workflowId: K,
			options?: { start?: boolean; where?: (value: WorkflowMap[K]) => boolean; afterSeq?: number },
		): Workflow<WorkflowMap[K], Dependency<K, WorkflowMap[K]>>;
	};
	join: <K extends keyof WorkflowMap & string>(
		workflowId: K,
		options?: { start?: boolean },
	) => Workflow<WorkflowMap[K], Dependency<K, WorkflowMap[K]>>;
	workflow: <K extends keyof WorkflowMap & string>(
		id: K,
	) => Workflow<WorkflowMap[K], Dependency<K, WorkflowMap[K]>>;
	publish: (value: PublishType) => Workflow<void, Publishes<PublishType>>;
	subscribe: {
		<K extends keyof WorkflowMap & string, S extends WorkflowMap[K], T = never>(
			workflowId: K,
			options: { start?: boolean; where: (value: WorkflowMap[K]) => value is S },
			body: (
				ctx: WorkflowContext<SignalMap, WorkflowMap, PublishType>,
				value: S,
				done: <D>(value: D) => Workflow<never>,
			) => Workflow<void, Requirement>,
		): Workflow<T, Dependency<K, WorkflowMap[K]>>;
		<K extends keyof WorkflowMap & string, T = never>(
			workflowId: K,
			options: { start?: boolean; where?: (value: WorkflowMap[K]) => boolean },
			body: (
				ctx: WorkflowContext<SignalMap, WorkflowMap, PublishType>,
				value: WorkflowMap[K],
				done: <D>(value: D) => Workflow<never>,
			) => Workflow<void, Requirement>,
		): Workflow<T, Dependency<K, WorkflowMap[K]>>;
	};

};

// Internal context type for the interpreter. Matches WorkflowContext structurally
// but without generic constraints that TypeScript can't satisfy at the erased level.
// workflow() narrows this to the user-facing WorkflowContext<SignalMap, WorkflowMap>.
export type InternalWorkflowContext = {
	activity: <T>(
		name: string,
		fn: (signal: AbortSignal) => Promise<T>,
	) => Workflow<T>;
	receive: (signal: string) => Workflow<unknown, Requirement>;
	handle: <T>(
		handlers: Record<
			string,
			(
				ctx: InternalWorkflowContext,
				payload: unknown,
				done: (value: unknown) => Workflow<never>,
			) => Workflow<void, Requirement>
		>,
	) => Workflow<T, Requirement>;
	sleep: (durationMs: number) => Workflow<void>;
	child: <T>(
		name: string,
		workflow: AnyWorkflowFunction,
	) => Workflow<T>;
	all: (
		...branches: Workflow<unknown, Requirement>[]
	) => Workflow<unknown[], Requirement>;
	race: (
		...branches: Workflow<unknown, Requirement>[]
	) => Workflow<{ winner: number; value: unknown }, Requirement>;
	published: (
		workflowId: string,
		options?: { start?: boolean; where?: (value: unknown) => boolean; afterSeq?: number },
	) => Workflow<unknown, Requirement>;
	join: (
		workflowId: string,
		options?: { start?: boolean },
	) => Workflow<unknown, Requirement>;
	workflow: (id: string) => Workflow<unknown, Requirement>;
	publish: (value: unknown) => Workflow<void, Requirement>;
	subscribe: <T>(
		workflowId: string,
		options: { start?: boolean; where?: (value: unknown) => boolean },
		body: (
			ctx: InternalWorkflowContext,
			value: unknown,
			done: (value: unknown) => Workflow<never>,
		) => Workflow<void, Requirement>,
	) => Workflow<T, Requirement>;
};

// Type alias for generators yielding descriptors (internal to interpreter)
type DescriptorGenerator<T = unknown> = Generator<Descriptor, T, unknown>;

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

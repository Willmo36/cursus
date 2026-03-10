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

// --- Commands (yielded by workflow generators) ---

export type ActivityCommand = {
	type: "activity";
	name: string;
	fn: (signal: AbortSignal) => Promise<unknown>;
	seq: number;
};

export type ReceiveCommand = {
	type: "receive";
	signal: string;
	seq: number;
};

export type SleepCommand = {
	type: "sleep";
	durationMs: number;
	seq: number;
};

export type ChildCommand = {
	type: "child";
	name: string;
	workflow: AnyWorkflowFunction;
	seq: number;
};

export type PublishedCommand = {
	type: "published";
	workflowId: string;
	start: boolean;
	seq: number;
};

export type JoinCommand = {
	type: "join";
	workflowId: string;
	start: boolean;
	seq: number;
};

export type PublishCommand = {
	type: "publish";
	value: unknown;
	seq: number;
};

export type RaceCommand = {
	type: "race";
	items: Command[];
	seq: number;
};

export type AllCommand = {
	type: "all";
	items: Command[];
	seq: number;
};

export type Command =
	| ActivityCommand
	| ReceiveCommand
	| SleepCommand
	| ChildCommand
	| PublishedCommand
	| JoinCommand
	| RaceCommand
	| AllCommand
	| PublishCommand;

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

export type Workflow<T> = Generator<Command, T, unknown>;

export type WorkflowFunction<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
	WorkflowMap extends Record<string, unknown> = Record<string, never>,
	PublishType = never,
> = (ctx: WorkflowContext<SignalMap, WorkflowMap, PublishType>) => Workflow<T>;

// Accepts any WorkflowFunction regardless of its result type, signal map, or workflow map.
// Uses `any` for SignalMap/WorkflowMap to bypass contravariance — safe because the registry
// only forwards the context it constructs, never reads SignalMap/WorkflowMap directly.
// biome-ignore lint/suspicious/noExplicitAny: type-erased boundary for registry storage
export type AnyWorkflowFunction = WorkflowFunction<any, any, any, any>;

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
		options?: { start?: boolean; caller?: string },
	): Promise<T>;
	waitForCompletion<T>(
		workflowId: string,
		options?: { start?: boolean; caller?: string },
	): Promise<T>;
	start(workflowId: string): Promise<void>;
	publish(workflowId: string, value: unknown): void;
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
		done: <T>(value: T) => Generator<Command, never, unknown>,
	) => Generator<Command, void, unknown>;
};

export type WorkflowContext<
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
	WorkflowMap extends Record<string, unknown> = Record<string, never>,
	PublishType = never,
> = {
	activity: <T>(
		name: string,
		fn: (signal: AbortSignal) => Promise<T>,
	) => Generator<Command, T, unknown>;
	receive: <K extends keyof SignalMap & string>(
		signal: K,
	) => Generator<Command, SignalMap[K], unknown>;
	handle: <T>(
		handlers: SignalHandlers<SignalMap, WorkflowMap, PublishType>,
	) => Generator<Command, T, unknown>;
	sleep: (durationMs: number) => Generator<Command, void, unknown>;
	child: <T, CS extends Record<string, unknown> = Record<string, unknown>>(
		name: string,
		workflow: WorkflowFunction<T, CS>,
	) => Generator<Command, T, unknown>;
	all: {
		<A, B>(
			a: Generator<Command, A, unknown>,
			b: Generator<Command, B, unknown>,
		): Generator<Command, [A, B], unknown>;
		<A, B, C>(
			a: Generator<Command, A, unknown>,
			b: Generator<Command, B, unknown>,
			c: Generator<Command, C, unknown>,
		): Generator<Command, [A, B, C], unknown>;
		<A, B, C, D>(
			a: Generator<Command, A, unknown>,
			b: Generator<Command, B, unknown>,
			c: Generator<Command, C, unknown>,
			d: Generator<Command, D, unknown>,
		): Generator<Command, [A, B, C, D], unknown>;
		(
			...branches: Generator<Command, unknown, unknown>[]
		): Generator<Command, unknown[], unknown>;
	};
	race: {
		<A, B>(
			a: Generator<Command, A, unknown>,
			b: Generator<Command, B, unknown>,
		): Generator<Command, RaceResult<[A, B]>, unknown>;
		<A, B, C>(
			a: Generator<Command, A, unknown>,
			b: Generator<Command, B, unknown>,
			c: Generator<Command, C, unknown>,
		): Generator<Command, RaceResult<[A, B, C]>, unknown>;
		<A, B, C, D>(
			a: Generator<Command, A, unknown>,
			b: Generator<Command, B, unknown>,
			c: Generator<Command, C, unknown>,
			d: Generator<Command, D, unknown>,
		): Generator<Command, RaceResult<[A, B, C, D]>, unknown>;
		(
			...branches: Generator<Command, unknown, unknown>[]
		): Generator<Command, { winner: number; value: unknown }, unknown>;
	};
	published: <K extends keyof WorkflowMap & string>(
		workflowId: K,
		options?: { start?: boolean },
	) => Generator<Command, WorkflowMap[K], unknown>;
	join: <K extends keyof WorkflowMap & string>(
		workflowId: K,
		options?: { start?: boolean },
	) => Generator<Command, WorkflowMap[K], unknown>;
	workflow: <K extends keyof WorkflowMap & string>(
		id: K,
	) => Generator<Command, WorkflowMap[K], unknown>;
	publish: (value: PublishType) => Generator<Command, void, unknown>;
};

// Internal context type for the interpreter. Matches WorkflowContext structurally
// but without generic constraints that TypeScript can't satisfy at the erased level.
// WorkflowFunction narrows this to the user-facing WorkflowContext<SignalMap, WorkflowMap>.
export type InternalWorkflowContext = {
	activity: <T>(
		name: string,
		fn: (signal: AbortSignal) => Promise<T>,
	) => Generator<Command, T, unknown>;
	receive: (signal: string) => Generator<Command, unknown, unknown>;
	handle: <T>(
		handlers: Record<
			string,
			(
				ctx: InternalWorkflowContext,
				payload: unknown,
				done: (value: unknown) => Generator<Command, never, unknown>,
			) => Generator<Command, void, unknown>
		>,
	) => Generator<Command, T, unknown>;
	sleep: (durationMs: number) => Generator<Command, void, unknown>;
	child: <T, CS extends Record<string, unknown>>(
		name: string,
		workflow: WorkflowFunction<T, CS>,
	) => Generator<Command, T, unknown>;
	all: (
		...branches: Generator<Command, unknown, unknown>[]
	) => Generator<Command, unknown[], unknown>;
	race: (
		...branches: Generator<Command, unknown, unknown>[]
	) => Generator<Command, { winner: number; value: unknown }, unknown>;
	published: (
		workflowId: string,
		options?: { start?: boolean },
	) => Generator<Command, unknown, unknown>;
	join: (
		workflowId: string,
		options?: { start?: boolean },
	) => Generator<Command, unknown, unknown>;
	workflow: (id: string) => Generator<Command, unknown, unknown>;
	publish: (value: unknown) => Generator<Command, void, unknown>;
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

// ABOUTME: Core type definitions for the workflow engine.
// ABOUTME: Defines commands, events, context, and storage interfaces.

// --- Heterogeneous waitForAll helpers ---

export type WorkflowRef<T = unknown> = {
	__brand: "WorkflowRef";
	__phantom?: T;
	workflow: string;
};

export type WaitForAllItem =
	| { kind: "signal"; name: string }
	| { kind: "workflow"; workflowId: string };

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

export type WaitForCommand = {
	type: "waitFor";
	signal: string;
	seq: number;
};

export type SleepCommand = {
	type: "sleep";
	durationMs: number;
	seq: number;
};

export type ParallelCommand = {
	type: "parallel";
	activities: Array<{
		name: string;
		fn: (signal: AbortSignal) => Promise<unknown>;
		seq: number;
	}>;
	seq: number;
};

export type WaitForAllCommand = {
	type: "waitForAll";
	items: WaitForAllItem[];
	seq: number;
};

export type ChildCommand = {
	type: "child";
	name: string;
	workflow: AnyWorkflowFunction;
	seq: number;
};

export type WaitForAnyCommand = {
	type: "waitForAny";
	signals: string[];
	seq: number;
};

export type WaitForWorkflowCommand = {
	type: "waitForWorkflow";
	workflowId: string;
	start: boolean;
	seq: number;
};

export type RaceCommand = {
	type: "race";
	items: Command[];
	seq: number;
};

export type Command =
	| ActivityCommand
	| WaitForCommand
	| WaitForAllCommand
	| WaitForAnyCommand
	| SleepCommand
	| ParallelCommand
	| ChildCommand
	| WaitForWorkflowCommand
	| RaceCommand;

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

export type WaitForAllStartedEvent = {
	type: "wait_all_started";
	items: WaitForAllItem[];
	seq: number;
	timestamp: number;
};

export type WaitForAllCompletedEvent = {
	type: "wait_all_completed";
	seq: number;
	results: Record<string, unknown>;
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

export type WorkflowDependencyFailedEvent = {
	type: "workflow_dependency_failed";
	workflowId: string;
	seq: number;
	error: string;
	stack?: string;
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
	| WaitForAllStartedEvent
	| WaitForAllCompletedEvent
	| TimerStartedEvent
	| TimerFiredEvent
	| ChildStartedEvent
	| ChildCompletedEvent
	| ChildFailedEvent
	| WorkflowDependencyStartedEvent
	| WorkflowDependencyCompletedEvent
	| WorkflowDependencyFailedEvent
	| RaceStartedEvent
	| RaceCompletedEvent
	| WorkflowCompletedEvent
	| WorkflowFailedEvent
	| WorkflowCancelledEvent;

// --- Workflow types ---

export type Workflow<T> = Generator<Command, T, unknown>;

export type WorkflowFunction<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
	WorkflowMap extends Record<string, unknown> = Record<string, never>,
	QueryMap extends Record<string, unknown> = Record<string, never>,
> = (ctx: WorkflowContext<SignalMap, WorkflowMap, QueryMap>) => Workflow<T>;

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
	waitFor<T>(workflowId: string, options?: { start?: boolean; caller?: string }): Promise<T>;
	start(workflowId: string): Promise<void>;
};

// --- Context (provided to workflow generators) ---

export type OnHandlers<
	SignalMap extends Record<string, unknown>,
	WorkflowMap extends Record<string, unknown>,
	QueryMap extends Record<string, unknown>,
> = {
	[K in keyof SignalMap & string]?: (
		ctx: WorkflowContext<SignalMap, WorkflowMap, QueryMap>,
		payload: SignalMap[K],
	) => Generator<Command, void, unknown>;
};

export type WorkflowContext<
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
	WorkflowMap extends Record<string, unknown> = Record<string, never>,
	QueryMap extends Record<string, unknown> = Record<string, never>,
> = {
	query: <K extends keyof QueryMap & string>(
		name: K,
		handler: () => QueryMap[K],
	) => void;
	activity: <T>(
		name: string,
		fn: (signal: AbortSignal) => Promise<T>,
	) => Generator<Command, T, unknown>;
	waitFor: <K extends keyof SignalMap & string>(
		signal: K,
	) => Generator<Command, SignalMap[K], unknown>;
	waitForAny: <K extends (keyof SignalMap & string)[]>(
		...signals: K
	) => Generator<
		Command,
		{
			[I in keyof K]: K[I] extends keyof SignalMap & string
				? { signal: K[I]; payload: SignalMap[K[I]] }
				: never;
		}[number],
		unknown
	>;
	on: <T>(
		handlers: OnHandlers<SignalMap, WorkflowMap, QueryMap>,
	) => Generator<Command, T, unknown>;
	done: <T>(value: T) => Generator<Command, never, unknown>;
	sleep: (durationMs: number) => Generator<Command, void, unknown>;
	parallel: <T>(
		activities: Array<{ name: string; fn: (signal: AbortSignal) => Promise<T> }>,
	) => Generator<Command, T[], unknown>;
	child: <T, CS extends Record<string, unknown> = Record<string, unknown>>(
		name: string,
		workflow: WorkflowFunction<T, CS>,
	) => Generator<Command, T, unknown>;
	waitForAll: <K extends ((keyof SignalMap & string) | WorkflowRef<unknown>)[]>(
		...args: K
	) => Generator<
		Command,
		{
			[I in keyof K]: K[I] extends WorkflowRef<infer R>
				? R
				: K[I] extends keyof SignalMap & string
					? SignalMap[K[I]]
					: never;
		},
		unknown
	>;
	race: (
		...branches: Generator<Command, unknown, unknown>[]
	) => Generator<Command, { winner: number; value: unknown }, unknown>;
	waitForWorkflow: <K extends keyof WorkflowMap & string>(
		workflowId: K,
		options?: { start?: boolean },
	) => Generator<Command, WorkflowMap[K], unknown>;
	workflow: <K extends keyof WorkflowMap & string>(
		id: K,
	) => WorkflowRef<WorkflowMap[K]>;
};

// Internal context type for the interpreter. Matches WorkflowContext structurally
// but without generic constraints that TypeScript can't satisfy at the erased level.
// WorkflowFunction narrows this to the user-facing WorkflowContext<SignalMap, WorkflowMap>.
export type InternalWorkflowContext = {
	query: (name: string, handler: () => unknown) => void;
	activity: <T>(
		name: string,
		fn: (signal: AbortSignal) => Promise<T>,
	) => Generator<Command, T, unknown>;
	waitFor: (signal: string) => Generator<Command, unknown, unknown>;
	waitForAny: (
		...signals: string[]
	) => Generator<Command, { signal: string; payload: unknown }, unknown>;
	on: <T>(
		handlers: Record<
			string,
			(
				ctx: InternalWorkflowContext,
				payload: unknown,
			) => Generator<Command, void, unknown>
		>,
	) => Generator<Command, T, unknown>;
	done: (value: unknown) => Generator<Command, never, unknown>;
	sleep: (durationMs: number) => Generator<Command, void, unknown>;
	parallel: <T>(
		activities: Array<{
			name: string;
			fn: (signal: AbortSignal) => Promise<T>;
		}>,
	) => Generator<Command, T[], unknown>;
	child: <T, CS extends Record<string, unknown>>(
		name: string,
		workflow: WorkflowFunction<T, CS>,
	) => Generator<Command, T, unknown>;
	waitForAll: (
		...args: (string | WorkflowRef)[]
	) => Generator<Command, unknown, unknown>;
	race: (
		...branches: Generator<Command, unknown, unknown>[]
	) => Generator<Command, { winner: number; value: unknown }, unknown>;
	waitForWorkflow: (
		workflowId: string,
		options?: { start?: boolean },
	) => Generator<Command, unknown, unknown>;
	workflow: (id: string) => WorkflowRef;
};

// --- Storage ---

export type WorkflowStorage = {
	load(workflowId: string): Promise<WorkflowEvent[]>;
	append(workflowId: string, events: WorkflowEvent[]): Promise<void>;
	compact(workflowId: string, events: WorkflowEvent[]): Promise<void>;
	clear(workflowId: string): Promise<void>;
};

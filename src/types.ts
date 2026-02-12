// ABOUTME: Core type definitions for the workflow engine.
// ABOUTME: Defines commands, events, context, and storage interfaces.

// --- Commands (yielded by workflow generators) ---

export type ActivityCommand = {
	type: "activity";
	name: string;
	fn: () => Promise<unknown>;
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
	activities: Array<{ name: string; fn: () => Promise<unknown>; seq: number }>;
	seq: number;
};

export type WaitAllCommand = {
	type: "waitAll";
	signals: string[];
	seq: number;
};

export type ChildCommand = {
	type: "child";
	name: string;
	workflow: WorkflowFunction<unknown>;
	seq: number;
};

export type Command =
	| ActivityCommand
	| WaitForCommand
	| WaitAllCommand
	| SleepCommand
	| ParallelCommand
	| ChildCommand;

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
	timestamp: number;
};

export type WaitAllStartedEvent = {
	type: "wait_all_started";
	signals: string[];
	seq: number;
	timestamp: number;
};

export type WaitAllCompletedEvent = {
	type: "wait_all_completed";
	seq: number;
	results: Record<string, unknown>;
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
	timestamp: number;
};

export type WorkflowEvent =
	| WorkflowStartedEvent
	| ActivityScheduledEvent
	| ActivityCompletedEvent
	| ActivityFailedEvent
	| SignalReceivedEvent
	| WaitAllStartedEvent
	| WaitAllCompletedEvent
	| TimerStartedEvent
	| TimerFiredEvent
	| ChildStartedEvent
	| ChildCompletedEvent
	| ChildFailedEvent
	| WorkflowCompletedEvent
	| WorkflowFailedEvent;

// --- Workflow types ---

export type Workflow<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
> = Generator<Command, T, unknown>;

export type WorkflowFunction<
	T,
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
> = (ctx: WorkflowContext<SignalMap>) => Workflow<T, SignalMap>;

export type WorkflowState = "running" | "waiting" | "completed" | "failed";

// --- Context (provided to workflow generators) ---

export type WorkflowContext<
	SignalMap extends Record<string, unknown> = Record<string, unknown>,
> = {
	activity: <T>(
		name: string,
		fn: () => Promise<T>,
	) => Generator<Command, T, unknown>;
	waitFor: <K extends keyof SignalMap & string>(
		signal: K,
	) => Generator<Command, SignalMap[K], unknown>;
	sleep: (durationMs: number) => Generator<Command, void, unknown>;
	parallel: <T>(
		activities: Array<{ name: string; fn: () => Promise<T> }>,
	) => Generator<Command, T[], unknown>;
	child: <T, CS extends Record<string, unknown> = Record<string, unknown>>(
		name: string,
		workflow: WorkflowFunction<T, CS>,
	) => Generator<Command, T, unknown>;
	waitAll: <K extends (keyof SignalMap & string)[]>(
		...signals: K
	) => Generator<Command, { [I in keyof K]: SignalMap[K[I]] }, unknown>;
};

// --- Storage ---

export type WorkflowStorage = {
	load(workflowId: string): Promise<WorkflowEvent[]>;
	append(workflowId: string, events: WorkflowEvent[]): Promise<void>;
	clear(workflowId: string): Promise<void>;
};

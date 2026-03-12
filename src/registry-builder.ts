// ABOUTME: Typed registry builder that checks workflow dependencies at compile time.
// ABOUTME: Each add() call verifies that Result and Published deps are already provided.

import { WorkflowRegistry } from "./registry";
import type {
	AnyWorkflowFunction,
	Published,
	Publishes,
	Requirements,
	Result,
	SignalMapOf,
	WorkflowEvent,
	WorkflowEventObserver,
	WorkflowState,
	WorkflowStorage,
} from "./types";

// Extracts the return type from a workflow function
// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
type WorkflowReturn<F> = F extends (...args: any[]) => Generator<any, infer T, any> ? T : never;

// Extracts the Publishes<V> type from a workflow's requirements
type ExtractPublishes<R> = R extends Publishes<infer V> ? V : never;

// Extracts Result dependency keys from a requirement union
type ResultDeps<R> = R extends Result<infer K, any> ? K : never;

// Extracts Published dependency keys from a requirement union
type PublishedDeps<R> = R extends Published<infer K, any> ? K : never;

// All dependency keys (Result + Published) from a requirement union
type DepKeys<R> = ResultDeps<R> | PublishedDeps<R>;

// Keys from R that are NOT in Provides
type UnsatisfiedDeps<R, Provides extends Record<string, unknown>> =
	Exclude<DepKeys<R>, keyof Provides>;

// Extracts requirements from a workflow function
// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
type ReqsOf<F> = F extends (...args: any[]) => Generator<any, any, any>
	? Requirements<ReturnType<F>>
	: never;

export type RegistryEntry = {
	result: unknown;
	published: unknown;
	signals: Record<string, unknown>;
};

// If deps are satisfied, resolves to F. Otherwise resolves to a descriptive error string.
type CheckDeps<F, Provides extends Record<string, unknown>> =
	[UnsatisfiedDeps<ReqsOf<F>, Provides>] extends [never]
		? F
		: `Missing dependencies: ${UnsatisfiedDeps<ReqsOf<F>, Provides> & string}`;

export type Registry<Provides extends Record<string, RegistryEntry> = {}> = {
	start(id: keyof Provides & string): Promise<void>;
	signal(id: keyof Provides & string, name: string, payload?: unknown): void;
	reset(id: keyof Provides & string): Promise<void>;
	getState<K extends keyof Provides & string>(id: K): WorkflowState<Provides[K]["result"]> | undefined;
	getEvents(id: keyof Provides & string): WorkflowEvent[];
	getWorkflowIds(): string[];
	readonly storage: WorkflowStorage;
	/** @internal */
	readonly _registry: WorkflowRegistry;
};

export type RegistryBuilder<Provides extends Record<string, RegistryEntry> = {}> = {
	// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
	add<K extends string, F extends (...args: any[]) => Generator<any, any, any>>(
		id: K,
		workflowFn: F & CheckDeps<F, Provides>,
	): RegistryBuilder<Provides & Record<K, {
		result: WorkflowReturn<F>;
		published: ExtractPublishes<ReqsOf<F>>;
		signals: SignalMapOf<F>;
	}>>;

	build(options?: { onEvent?: WorkflowEventObserver | WorkflowEventObserver[] }): Registry<Provides>;
};

export function createRegistry(
	storage: WorkflowStorage,
): RegistryBuilder {
	const workflows: Record<string, AnyWorkflowFunction> = {};

	const builder: RegistryBuilder = {
		add(id: string, workflowFn: AnyWorkflowFunction) {
			workflows[id] = workflowFn;
			return builder;
		},
		build(options?: { onEvent?: WorkflowEventObserver | WorkflowEventObserver[] }) {
			const observers = options?.onEvent
				? Array.isArray(options.onEvent)
					? options.onEvent
					: [options.onEvent]
				: undefined;
			const inner = new WorkflowRegistry(workflows, storage, observers);
			const registry = Object.create(inner);
			registry._registry = inner;
			return registry as unknown as Registry;
		},
	} as any;

	return builder;
}

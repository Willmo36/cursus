// ABOUTME: Typed registry builder that checks workflow dependencies at compile time.
// ABOUTME: Each add() call verifies that Result and Published deps are already provided.

import type {
	AnyWorkflowFunction,
	Published,
	Publishes,
	Requirements,
	Result,
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

type RegistryEntry = {
	result: unknown;
	published: unknown;
};

// If deps are satisfied, resolves to F. Otherwise resolves to a descriptive never.
type CheckDeps<F, Provides extends Record<string, unknown>> =
	[UnsatisfiedDeps<ReqsOf<F>, Provides>] extends [never]
		? F
		: `Missing dependencies: ${UnsatisfiedDeps<ReqsOf<F>, Provides> & string}`;

export type RegistryBuilder<Provides extends Record<string, RegistryEntry> = {}> = {
	// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
	add<K extends string, F extends (...args: any[]) => Generator<any, any, any>>(
		id: K,
		workflowFn: F & CheckDeps<F, Provides>,
	): RegistryBuilder<Provides & Record<K, {
		result: WorkflowReturn<F>;
		published: ExtractPublishes<ReqsOf<F>>;
	}>>;
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
	} as any;

	return builder;
}

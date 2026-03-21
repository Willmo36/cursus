// ABOUTME: Typed registry builder that checks workflow dependencies at compile time.
// ABOUTME: Each add() call verifies that Output deps are already provided.

import { WorkflowRegistry } from "./registry";
import type {
	AnyWorkflow,
	CheckDeps,
	ExtractPublishes,
	ReqsOf,
	SignalMapOf,
	WorkflowEvent,
	WorkflowEventObserver,
	WorkflowReturn,
	WorkflowState,
	WorkflowStorage,
} from "./types";

export type RegistryEntry = {
	result: unknown;
	published: unknown;
	signals: Record<string, unknown>;
};

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

// Checks that overlapping keys between two registries have compatible result types.
// If a key exists in both, the result types must be identical.
type OverlappingKeys<A, B> = keyof A & keyof B;

type CheckOverlap<A extends Record<string, RegistryEntry>, B extends Record<string, RegistryEntry>> =
	[OverlappingKeys<A, B>] extends [never]
		? unknown
		: OverlappingKeys<A, B> extends infer K
			? K extends string
				? A[K]["result"] extends B[K]["result"]
					? B[K]["result"] extends A[K]["result"]
						? unknown
						: `Key "${K}" has incompatible result types across registries`
					: `Key "${K}" has incompatible result types across registries`
				: unknown
			: unknown;

export type MergeResolver = (a: AnyWorkflow, b: AnyWorkflow, key: string) => AnyWorkflow;

export type RegistryBuilder<Provides extends Record<string, RegistryEntry> = {}> = {
	// biome-ignore lint/suspicious/noExplicitAny: need any for generator inference
	add<K extends string, F extends AnyWorkflow | ((...args: any[]) => Generator<any, any, any>)>(
		id: K,
		workflowFn: F & CheckDeps<F, Provides>,
	): RegistryBuilder<Provides & Record<K, {
		result: WorkflowReturn<F>;
		published: ExtractPublishes<ReqsOf<F>>;
		signals: SignalMapOf<F>;
	}>>;

	merge<Other extends Record<string, RegistryEntry>>(
		other: RegistryBuilder<Other> & CheckOverlap<Provides, Other>,
		resolver?: MergeResolver,
	): RegistryBuilder<Provides & Other>;

	build(options?: { onEvent?: WorkflowEventObserver | WorkflowEventObserver[] }): Registry<Provides>;

	/** @internal */
	readonly _workflows: Record<string, AnyWorkflow>;
	/** @internal */
	readonly _storageMap: Record<string, WorkflowStorage>;
	/** @internal */
	readonly _defaultStorage: WorkflowStorage;
};

export function createRegistry(
	storage: WorkflowStorage,
): RegistryBuilder {
	return makeBuilder(storage, {}, {});
}

function makeBuilder(
	defaultStorage: WorkflowStorage,
	workflows: Record<string, AnyWorkflow>,
	storageMap: Record<string, WorkflowStorage>,
): RegistryBuilder {
	const builder: RegistryBuilder = {
		_workflows: workflows,
		_storageMap: storageMap,
		_defaultStorage: defaultStorage,
		add(id: string, wf: AnyWorkflow) {
			workflows[id] = wf;
			storageMap[id] = defaultStorage;
			return builder;
		},
		merge(other: RegistryBuilder, resolver?: MergeResolver) {
			const merged = { ...workflows };
			const mergedStorage = { ...storageMap };
			for (const [id, wf] of Object.entries(other._workflows)) {
				if (id in merged && resolver) {
					merged[id] = resolver(merged[id], wf, id);
				} else {
					merged[id] = wf;
				}
				mergedStorage[id] = other._storageMap[id] ?? other._defaultStorage;
			}
			return makeBuilder(defaultStorage, merged, mergedStorage);
		},
		build(options?: { onEvent?: WorkflowEventObserver | WorkflowEventObserver[] }) {
			const observers = options?.onEvent
				? Array.isArray(options.onEvent)
					? options.onEvent
					: [options.onEvent]
				: undefined;
			const inner = new WorkflowRegistry(workflows, defaultStorage, { observers, storageMap });
			const registry = Object.create(inner);
			registry._registry = inner;
			return registry as unknown as Registry;
		},
	} as any;

	return builder;
}

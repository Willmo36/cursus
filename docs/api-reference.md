---
sidebar_position: 8
---

# API Reference

Exhaustive reference for all public exports from `cursus`.

## Hooks

### useWorkflow

```ts
// Consumes a workflow from the registry Provider in context
function useWorkflow<T>(workflowId: string): UseWorkflowResult<T>;

// Consumes a workflow from an explicit typed registry (no Provider needed)
function useWorkflow<P, K extends keyof P & string>(
  workflowId: K,
  registry: Registry<P>,
): UseWorkflowResult<P[K]["result"], P[K]["signals"]>;
```

Requires a registry `Provider` ancestor (or an explicit `registry` argument). Throws if neither is present.

**UseWorkflowResult:**

| Field | Type |
|-------|------|
| `state` | `WorkflowState<T>` |
| `published` | `unknown` |
| `signal(name, payload)` | `(name: K, payload: ReceiveMap[K]) => void` — delivers a payload to the workflow's waiting `receive(name)` |
| `cancel()` | `() => void` |
| `reset()` | `() => void` |

`WorkflowState<T>` is a tagged union:

```ts
type WorkflowState<T> =
  | { status: "running" }
  | { status: "waiting" }
  | { status: "completed"; result: T }
  | { status: "failed"; error: string }
  | { status: "cancelled" };
```

### useWorkflowEvents

```ts
function useWorkflowEvents(): WorkflowEventLog[];
```

Returns live event logs for all workflows in the current registry. Requires a registry `Provider`.

**WorkflowEventLog:**

```ts
type WorkflowEventLog = {
  id: string;
  events: WorkflowEvent[];
};
```

### usePublished

```ts
function usePublished<T>(
  workflowId: string,
  selector: (published: unknown) => T,
): T | undefined;
```

Selects a slice of a workflow's published state. Only re-renders when the selected value changes (by reference). Requires a registry context (`createBindings` `Provider`).

Returns `undefined` before the workflow publishes.

In `createBindings`, the selector input is typed from the registry:

```ts
const { usePublished } = createBindings(registry);
// selector receives the workflow's published type, not `unknown`
const name = usePublished("profile", (pub) => pub.name);
```

## Components

### WorkflowDebugPanel

```tsx
<WorkflowDebugPanel onClear?: () => void />
```

Fixed-position debug panel with event inspector and timeline views.

## Registry

### WorkflowRegistry

```ts
class WorkflowRegistry<K extends string = string>
```

Manages shared workflow instances. Created via `createRegistry().build()`.

| Method | Description |
|--------|-------------|
| `start(id)` | Start a workflow. Idempotent. |
| `waitFor<T>(id, options?)` | Wait for a workflow's output (published or completed). Auto-starts by default. |
| `publish(id, value)` | Mark a workflow as published and resolve all waiters. |
| `reset(id)` | Cancel, clear storage, allow restart. |
| `signal(id, name, payload?)` | Send a signal to a running workflow. |
| `getState(id)` | Get current `WorkflowState`. |
| `getPublished(id)` | Get the current published value. |
| `getEvents(id)` | Get the in-memory event log. |
| `getInterpreter(id)` | Get the `Interpreter` instance. |
| `getWorkflowIds()` | List all registered workflow IDs. |
| `onStateChange(id, callback)` | Subscribe to state changes. Returns unsubscribe function. |
| `getTrace(id)` | Get a `WorkflowTrace` envelope with version metadata and events. |
| `onWorkflowsChange(callback)` | Subscribe to workflow additions/removals. Returns unsubscribe function. |

### createRegistry

```ts
function createRegistry(storage?: WorkflowStorage): RegistryBuilder;
```

Builder for type-safe registries. Chain `.add(id, workflow)` to register workflows, then `.build()` to produce a `Registry`. Defaults to `MemoryStorage` when no storage is provided.

```ts
const registry = createRegistry(new LocalStorage())
  .add("profile", profileWorkflow)
  .add("checkout", checkoutWorkflow)
  .build();
```

The builder tracks provided types — later `add()` calls can depend on earlier ones, and the compiler verifies that all dependencies are satisfied.

### merge

```ts
builder.merge(otherBuilder, resolver?): RegistryBuilder;
```

Merges two registry builders. Overlapping keys must have compatible result types (enforced at compile time). An optional `resolver` function handles runtime conflicts for overlapping keys.

```ts
const combined = authRegistry.merge(paymentRegistry).build();
```

### handler

```ts
function handler(): SignalReceiver;
```

Builder for multi-signal receive loops. Chain `.on(signal, fn)` to add handlers, then `.as<T>()` to produce a generator. The loop runs until a handler calls `done(value)`.

```ts
const result = yield* handler()
  .on("add", function* (item: string) {
    items.push(item);
    yield* publish(items);
  })
  .on("checkout", function* (_payload, done) {
    yield* done(items);
  })
  .as<string[]>();
```

## SSR

### runRegistry

```ts
function runRegistry<Provides>(
  registry: Registry<Provides>,
  ids?: Array<keyof Provides & string>,
): Promise<RegistrySnapshot<Provides>>;
```

Runs all (or selected) workflows in the registry to completion or until they block on `receive`, then returns a per-workflow snapshot for client-side hydration. Each snapshot is JSON-serializable.

```ts
import { createRegistry, MemoryStorage, runRegistry } from "cursus";

const registry = createRegistry(new MemoryStorage())
  .add("product", productWorkflow)
  .build();

const snapshots = await runRegistry(registry);
// snapshots.product — WorkflowSnapshot
```

### WorkflowSnapshot

```ts
type WorkflowSnapshot = {
  workflowId: string;
  events: WorkflowEvent[];
  state: WorkflowState;
  published: unknown;
};
```

### RegistrySnapshot

```ts
type RegistrySnapshot<Provides> = {
  [K in keyof Provides & string]: WorkflowSnapshot;
};
```

See [SSR & Hydration](./ssr.md) for full usage patterns.

## Storage

### MemoryStorage

```ts
class MemoryStorage implements WorkflowStorage
```

In-memory storage. Events are lost on page reload.

### LocalStorage

```ts
class LocalStorage implements WorkflowStorage
```

**Constructor:** `new LocalStorage(prefix = "cursus")`

Persists to `window.localStorage`. Keys: `${prefix}:${workflowId}` for events, `${prefix}:${workflowId}:v` for version.

### WorkflowStorage

```ts
type WorkflowStorage = {
  load(workflowId: string): Promise<WorkflowEvent[]>;
  append(workflowId: string, events: WorkflowEvent[]): Promise<void>;
  clear(workflowId: string): Promise<void>;
  loadVersion?(workflowId: string): Promise<number | undefined>;
  saveVersion?(workflowId: string, version: number): Promise<void>;
};
```

### checkVersion

```ts
function checkVersion(
  storage: WorkflowStorage,
  workflowId: string,
  version: number | undefined,
): Promise<boolean>;
```

Returns `true` if storage was wiped due to version mismatch. No-op when version is `undefined` or storage lacks version methods.

## Workflow Functions

Free functions imported from `"cursus"` for building workflows:

```ts
import {
  workflow, activity, ask, receive, sleep, publish,
  race, all, child, loop, loopBreak, handler,
} from "cursus";
```

### workflow

```ts
function workflow<A, R = never>(fn: () => WorkflowGenerator<A, R>): Workflow<A, R>;
```

Wraps a generator function as a workflow, returning a `Workflow` instance with `.map()` and `.provide()` combinators.

### activity

```ts
function activity<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
): [T] extends [Serializable<T>]
  ? Generator<ActivityDescriptor, T, unknown>
  : Serializable<T>;
```

Run an async activity. On replay, the stored result is returned without calling `fn`.

Because the result is serialized into the event log, `T` is constrained to a JSON-serializable shape. Passing `() => void` or `Map<K,V>` or a class instance produces a readable compile-time error at the `yield*` site.

### ask

```ts
function ask<V, K extends string>(label: K): Generator<AskDescriptor, V, unknown> & {
  as: <W>() => Generator<AskDescriptor, W, unknown>;
};
```

Resolve a value from a registered workflow's output (published or returned). The registry must have a workflow registered at `label`; otherwise `ask()` throws.

On replay, the registry re-runs the target workflow and produces its value live — the value is never stored in the event log. This means `V` is unconstrained: `ask()` can return service bundles, class instances, closures, or anything the producer workflow yields.

```ts
const services = yield* ask("api-services").as<ApiServices>();
```

### receive

```ts
function receive<V, K extends string>(label: K): Generator<ReceiveDescriptor, V, unknown> & {
  as: <W>() => [W] extends [Serializable<W>]
    ? Generator<ReceiveDescriptor, W, unknown>
    : Serializable<W>;
};
```

Wait for an external `signal(label, payload)` call. The payload is recorded in the event log and returned verbatim on replay.

Because the payload is serialized, `V` must be JSON-serializable. Non-serializable payload types produce a compile-time error at `.as<V>()`.

```ts
const email = yield* receive<string>("email");
const loginData = yield* receive("login").as<{ user: string; token: string }>();
```

### handler

`handler()` builds a multi-signal receive loop. Chain `.on(signalName, fn)` for each signal, then `.as<T>()` to produce the generator. The loop runs until a handler calls `done(value)`:

```ts
const result = yield* handler()
  .on("add", function* (item: string) {
    items.push(item);
    yield* publish(items);
  })
  .on("checkout", function* (_payload, done) {
    yield* done(items);
  })
  .as<string[]>();
```

**Example — a todo store using receive + handler:**

```ts
const todoStore = workflow(function* () {
  // Wait for a single signal
  const name = yield* receive("login").as<string>();

  // Multi-signal loop — runs until a handler calls done
  let items: string[] = [];
  const final = yield* handler()
    .on("add", function* (text: string) {
      items = [...items, text];
      yield* publish(items);
    })
    .on("remove", function* (index: number) {
      items = items.filter((_, i) => i !== index);
      yield* publish(items);
    })
    .on("checkout", function* (_payload, done) {
      yield* done(items);
    })
    .as<string[]>();

  return { user: name, items: final };
});
```

### sleep

```ts
function sleep(durationMs: number): Generator<SleepDescriptor, void, unknown>;
```

Durable timer that survives page reloads.

### child

```ts
function child<W extends Workflow<any, any>>(
  name: string,
  wf: W,
): Generator<ChildDescriptor, WorkflowReturn<W>, unknown>;
```

Delegate to a child workflow with its own event log scope. Return type and requirements are inferred from the `Workflow` instance.

### publish

```ts
function publish<V>(value: V): Generator<PublishDescriptor, void, unknown>;
```

Publish a value to consumers without completing the workflow.

### all

```ts
function all<A, B>(a: Generator<A>, b: Generator<B>): Generator<AllDescriptor, [RA, RB], unknown>;
function all<A, B, C>(a, b, c): Generator<AllDescriptor, [RA, RB, RC], unknown>;
function all<A, B, C, D>(a, b, c, d): Generator<AllDescriptor, [RA, RB, RC, RD], unknown>;
function all(...branches): Generator<AllDescriptor, unknown[], unknown>;
```

Wait for all branches to complete. Returns a tuple of results in order.

### race

```ts
function race<A, B>(a: Generator<A>, b: Generator<B>): Generator<RaceDescriptor, { winner: number; value: RA | RB }, unknown>;
function race<A, B, C>(a, b, c): Generator<RaceDescriptor, { winner: number; value: RA | RB | RC }, unknown>;
function race(...branches): Generator<RaceDescriptor, { winner: number; value: unknown }, unknown>;
```

Race branches — first to complete wins. Returns `{ winner, value }` where `winner` is the zero-based index.

### loop

```ts
function loop<F extends () => Generator>(body: F): Workflow<T>;
```

Repeat a body generator factory until `loopBreak` is yielded inside it. The body factory is called fresh each iteration (generators are single-use). Returns the value passed to `loopBreak`.

### loopBreak

```ts
function loopBreak<V>(value: V): Workflow<never>;
```

Exit the enclosing `loop` with a value. Must be used inside a `loop` body.

## Types

### Workflow

```ts
class Workflow<A, R = never> {
  map<B>(fn: (a: A) => B): Workflow<B, R>;
  provide<P extends R>(provided: P): Workflow<A, Exclude<R, P>>;
}
```

The core workflow class. `A` is the return type, `R` is the requirements type (queries, dependencies). Returned by `workflow()`.

### WorkflowGenerator

```ts
type WorkflowGenerator<A, R = never> = Generator<Descriptor & Step<R>, A, unknown>;
```

The raw generator type for the internals of a workflow. Used for primitive/advanced use cases.

### AnyWorkflow

```ts
type AnyWorkflow = Workflow<unknown, never>;
```

Utility type for a `Workflow` with unknown return type and no requirements.

### ReceiveMapOf

```ts
type ReceiveMapOf<F> = // infers receive label/value map from a workflow function
```

Extracts the receive label/value map from a workflow function type. Used internally by `useWorkflow` for type-safe `signal(name, payload)` calls.

### Serializable

```ts
type Serializable<T>
```

Structural check that `T` round-trips cleanly through `JSON.stringify` / `JSON.parse`. Primitives, plain objects, arrays, and `Date` pass. Functions, `Map`, `Set`, `Promise`, `RegExp`, `bigint`, and `symbol` are rejected; objects containing any of those as members are also rejected.

Applied automatically to `activity()` return types and `receive().as<V>()` payloads — non-serializable shapes surface as readable compile-time errors.

### Asks / Receives / Publishes

```ts
type Asks<K extends string, V>       // requirement: value V from registry workflow K
type Receives<K extends string, V>   // requirement: signal named K with payload V
type Publishes<V>                    // producer: emits values of type V
```

Phantom requirement tags tracked in the `R` parameter of `Workflow<A, R>`. Accumulate through `yield*` composition with no runtime cost.

### CancelledError

```ts
class CancelledError extends Error
```

Thrown into the generator when a workflow is cancelled.

### WorkflowRegistryInterface

```ts
type WorkflowRegistryInterface = {
  waitFor<T>(workflowId: string, options?: { start?: boolean; caller?: string }): Promise<T>;
  start(workflowId: string): Promise<void>;
  publish(workflowId: string, value: unknown): void;
};
```

Interface used by the interpreter to resolve workflow dependencies.

## Testing

### createTestRuntime

```ts
function createTestRuntime<T>(
  workflowFn: Workflow<T>,
  options: TestRuntimeOptions,
): Promise<T>;
```

**TestRuntimeOptions:**

| Field | Type | Description |
|-------|------|-------------|
| `activities` | `Record<string, (...args) => unknown>` | Mock activity implementations |
| `signals` | `Array<{ name: K; payload: ReceiveMap[K] }>` | Pre-queued signals |
| `workflowResults` | `Record<string, unknown>` | Mock `ask()` results for cross-workflow dependencies |

## Observability

### WorkflowEventObserver

```ts
type WorkflowEventObserver = (
  workflowId: string,
  event: WorkflowEvent,
) => void;
```

### WorkflowEvent

Union of all event types. See [Observability > Event Types](./observability.md#event-types) for the full list.

## Event Versioning

### WorkflowTrace

```ts
type WorkflowTrace = {
  schemaVersion: number;    // monotonic integer, bumped on schema changes
  libraryVersion: string;   // npm package version (e.g. "0.1.0")
  workflowId: string;
  events: WorkflowEvent[];
};
```

Envelope wrapping a workflow's event log with version metadata. Returned by `registry.getTrace(id)`.

### EVENT_SCHEMA_VERSION

```ts
const EVENT_SCHEMA_VERSION: number; // currently 5
```

Monotonic integer incremented when event shapes change.

### LIBRARY_VERSION

```ts
const LIBRARY_VERSION: string;
```

The npm package version, injected at build time.

### eventSchema

```ts
import { eventSchema } from "cursus";
```

JSON Schema (draft 2020-12) describing `WorkflowTrace` and all event types. Useful for validating events from external sources.

## Command Types

These are the internal command types yielded by workflow generators. Exported for advanced use cases (custom interpreters, tooling).

| Type | Description |
|------|-------------|
| `ActivityCommand` | Run an async activity |
| `QueryCommand` | Wait for a value by label (signal or workflow output) |
| `AllCommand` | Wait for multiple items to all complete |
| `SleepCommand` | Durable timer |
| `ChildCommand` | Child workflow delegation |
| `RaceCommand` | Race branches |
| `PublishCommand` | Publish a value to waiters |
| `LoopCommand` | Repeat a body until break |
| `LoopBreakCommand` | Exit a loop with a value |
| `Command` | Union of all command types |

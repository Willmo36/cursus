---
sidebar_position: 8
---

# API Reference

Exhaustive reference for all public exports from `cursus`.

## Hooks

### useWorkflow

```ts
// Layer mode — consumes a workflow from WorkflowLayerProvider
function useWorkflow<T>(
  workflowId: string,
): UseWorkflowResult<T>;

// Inline mode — runs a workflow directly
function useWorkflow<T>(
  workflowId: string,
  workflowFn: Workflow<T>,
  options?: UseWorkflowOptions,
): UseWorkflowResult<T>;
```

**UseWorkflowOptions:**

| Field | Type | Description |
|-------|------|-------------|
| `storage` | `WorkflowStorage` | Storage backend. Defaults to registry storage or ephemeral `MemoryStorage`. |
| `onEvent` | `WorkflowEventObserver \| WorkflowEventObserver[]` | Event observer(s) |
| `version` | `number` | Version stamp. Mismatched version wipes storage and restarts. |
| `snapshot` | `WorkflowSnapshot` | SSR snapshot for hydration. |

**UseWorkflowResult:**

| Field | Type |
|-------|------|
| `state` | `WorkflowState<T>` |
| `published` | `unknown` |
| `signal(name, payload)` | `(name: K, payload: SignalMap[K]) => void` |
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

Returns live event logs for all workflows in the current registry. Requires `WorkflowLayerProvider`.

**WorkflowEventLog:**

```ts
type WorkflowEventLog = {
  id: string;
  events: WorkflowEvent[];
};
```

## Components

### WorkflowLayerProvider

```tsx
<WorkflowLayerProvider layer={layer}>
  {children}
</WorkflowLayerProvider>
```

Provides a workflow layer to the component tree via React context.

### WorkflowDebugPanel

```tsx
<WorkflowDebugPanel onClear?: () => void />
```

Fixed-position debug panel with event inspector and timeline views.

## Layer

### createLayer

```ts
function createLayer<Provides extends Record<string, unknown>>(
  workflows: { [K in keyof Provides]: AnyWorkflowFunction },
  storage: WorkflowStorage,
  options?: CreateLayerOptions<Provides>,
): WorkflowLayer<Provides>;
```

**CreateLayerOptions:**

| Field | Type | Description |
|-------|------|-------------|
| `onEvent` | `WorkflowEventObserver \| WorkflowEventObserver[]` | Event observer(s) |
| `versions` | `Partial<{ [K in keyof Provides]: number }>` | Version stamps per workflow |

### WorkflowLayer

```ts
type WorkflowLayer<Provides> = {
  workflows: { [K in keyof Provides]: AnyWorkflowFunction };
  storage: WorkflowStorage;
  onEvent?: WorkflowEventObserver[];
  versions?: Partial<{ [K in keyof Provides]: number }>;
};
```

## Registry

### WorkflowRegistry

```ts
class WorkflowRegistry<K extends string = string>
```

Manages shared workflow instances. Created automatically by `WorkflowLayerProvider`.

| Method | Description |
|--------|-------------|
| `start(id)` | Start a workflow. Idempotent. |
| `waitFor<T>(id, options?)` | Wait for a workflow's output (published or completed). Auto-starts by default. |
| `publish(id, value)` | Mark a workflow as published and resolve all waiters. |
| `reset(id)` | Cancel, clear storage, allow restart. |
| `signal(id, name, payload?)` | Send a signal to a running workflow. |
| `getState(id)` | Get current `WorkflowState`. |
| `getEvents(id)` | Get the in-memory event log. |
| `getInterpreter(id)` | Get the `Interpreter` instance. |
| `getWorkflowIds()` | List all registered workflow IDs. |
| `onStateChange(id, callback)` | Subscribe to state changes. Returns unsubscribe function. |
| `getTrace(id)` | Get a `WorkflowTrace` envelope with version metadata and events. |
| `onWorkflowsChange(callback)` | Subscribe to workflow additions/removals. Returns unsubscribe function. |
| `observe(id, interpreter)` | Register an external interpreter (used by inline workflows). |
| `unobserve(id)` | Remove an observed interpreter. |

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
  compact(workflowId: string, events: WorkflowEvent[]): Promise<void>;
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
  workflow, activity, query, sleep, publish,
  race, all, child, loop, loopBreak,
} from "cursus";
```

### workflow

```ts
function workflow<F>(fn: F): F;
```

Wraps a generator function as a workflow.

### activity

```ts
function activity<T>(
  name: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Generator<ActivityDescriptor, T, unknown>;
```

Run an async activity. On replay, the stored result is returned without calling `fn`.

### query

`query` has three overloads covering all waiting patterns — it auto-matches the registry (for cross-workflow dependencies) or falls through to signal:

**1. One query, once** — wait for a single value by label and return it:

```ts
function query<V, K extends string>(label: K): Workflow<V, Query<K, V>>;
```

**2. One query, loop** — receive the same label repeatedly until the handler calls `done`:

```ts
function query<T, K extends string>(
  label: K,
  handler: (payload: V, done: <D>(value: D) => Workflow<never>) => Generator,
): Workflow<T, Query<K, V>>;
```

**3. N queries, loop** — dispatch to named handlers until one calls `done`:

```ts
function query<T>(
  handlers: Record<string, (payload, done) => Generator>,
): Workflow<T, Query<K, V>>;
```

**Example — a todo store using all three forms:**

```ts
const todoStore = workflow(function* () {
  // 1. One query, once — wait for the user's name
  const name = yield* query("login").as<string>();

  // 2. One query, loop — collect todos one at a time
  const todos: string[] = yield* query("add-todo", function* (text: string, done) {
    todos.push(text);
    if (todos.length >= 3) {
      yield* done(todos);
    }
  });

  // 3. N queries, loop — manage the list until checkout
  let items = todos;
  const final = yield* query<string[]>({
    add: function* (text: string) {
      items = [...items, text];
      yield* publish(items);
    },
    remove: function* (index: number) {
      items = items.filter((_, i) => i !== index);
      yield* publish(items);
    },
    checkout: function* (_payload, done) {
      yield* done(items);
    },
  });

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
function child<T>(
  name: string,
  workflowFn: (...args: any[]) => Generator<any, T, unknown>,
): Generator<ChildDescriptor, T, unknown>;
```

Delegate to a child workflow with its own event log scope.

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
type Workflow<A, R = never> = Generator<Descriptor & Step<R>, A, unknown>;
```

The core workflow type. `A` is the return type, `R` is the requirements type (queries, dependencies).

### SignalMapOf

```ts
type SignalMapOf<F> = // infers query map from a workflow function
```

Extracts the query label/value map from a workflow function type. Used internally by `useWorkflow` for type-safe `signal()` calls.

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

## Resilience

### withRetry

```ts
function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  policy?: RetryPolicy,
): (signal: AbortSignal) => Promise<T>;
```

### RetryPolicy

```ts
type RetryPolicy = {
  maxAttempts?: number;       // default: 3
  backoff?: "fixed" | "linear" | "exponential";  // default: "exponential"
  initialDelayMs?: number;    // default: 1000
  maxDelayMs?: number;        // default: 30000
};
```

### withCircuitBreaker

```ts
function withCircuitBreaker<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  policy?: CircuitBreakerPolicy,
): (signal: AbortSignal) => Promise<T>;
```

### CircuitBreakerPolicy

```ts
type CircuitBreakerPolicy = {
  failureThreshold?: number;  // default: 5
  resetTimeoutMs?: number;    // default: 30000
  halfOpenMax?: number;
};
```

### CircuitOpenError

```ts
class CircuitOpenError extends Error
```

Thrown when calling a circuit-broken function while the circuit is open.

### wrapActivity

```ts
function wrapActivity(...wrappers: ActivityWrapper[]): ActivityWrapper;
```

Composes multiple activity wrappers right-to-left.

### ActivityWrapper

```ts
type ActivityWrapper = <T>(
  fn: (signal: AbortSignal) => Promise<T>,
) => (signal: AbortSignal) => Promise<T>;
```

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
| `signals` | `Array<{ name: K; payload: SignalMap[K] }>` | Pre-queued signals |
| `workflowResults` | `Record<string, unknown>` | Mock `query` results for cross-workflow dependencies |

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
const EVENT_SCHEMA_VERSION: number; // currently 1
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

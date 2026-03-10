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
): UseWorkflowResult<T, Record<string, unknown>>;

// Inline mode — runs a workflow directly
function useWorkflow<T, SignalMap, WorkflowMap>(
  workflowId: string,
  workflowFn: WorkflowFunction<T, SignalMap, WorkflowMap>,
  options?: UseWorkflowOptions,
): UseWorkflowResult<T, SignalMap>;
```

**UseWorkflowOptions:**

| Field | Type | Description |
|-------|------|-------------|
| `storage` | `WorkflowStorage` | Storage backend. Defaults to registry storage or ephemeral `MemoryStorage`. |
| `onEvent` | `WorkflowEventObserver \| WorkflowEventObserver[]` | Event observer(s) |
| `version` | `number` | Version stamp. Mismatched version wipes storage and restarts. |

**UseWorkflowResult:**

| Field | Type |
|-------|------|
| `state` | `WorkflowState` |
| `result` | `T \| undefined` |
| `error` | `string \| undefined` |
| `receiving` | `string \| undefined` |
| `waitingForAll` | `string[] \| undefined` |
| `waitingForAny` | `string[] \| undefined` |
| `signal(name, payload)` | `(name: K, payload: SignalMap[K]) => void` |
| `published` | `T \| undefined` |
| `cancel()` | `() => void` |
| `reset()` | `() => void` |

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
| `waitForPublished<T>(id, options?)` | Wait for a workflow's published value. Auto-starts by default. |
| `waitForCompletion<T>(id, options?)` | Wait for a workflow to complete. Auto-starts by default. |
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

## Workflow Types

### WorkflowFunction

```ts
type WorkflowFunction<T, SignalMap, WorkflowMap, PublishType = never> = (
  ctx: WorkflowContext<SignalMap, WorkflowMap, PublishType>,
) => Generator<Command, T, unknown>;
```

### WorkflowContext

| Method | Signature | Description |
|--------|-----------|-------------|
| `activity` | `(name, fn) => Generator` | Run an async activity |
| `receive` | `(signal) => Generator` | Wait for a named signal |
| `all` | `(...generators) => Generator` | Wait for multiple signals/workflows/activities to all complete |
| `race` | `(...generators) => Generator` | Race branches, first wins — returns `{winner, value}` |
| `sleep` | `(durationMs) => Generator` | Durable timer |
| `child` | `(name, workflow) => Generator` | Delegate to a child workflow |
| `handle` | `(handlers) => Generator` | Signal dispatch loop |
| `done` | `(value) => Generator` | Exit a `handle` loop with a value |
| `join` | `(id, options?) => Generator` | Wait for a workflow to complete |
| `published` | `(id, options?) => Generator` | Wait for a workflow to publish a value |
| `workflow` | `(id) => Generator` | Wait for a workflow to complete (same as `join`) |
| `publish` | `(value) => Generator` | Resolve waiters without completing (requires `PublishType`) |

### WorkflowState

```ts
type WorkflowState = "running" | "waiting" | "completed" | "failed" | "cancelled";
```

### CancelledError

```ts
class CancelledError extends Error
```

Thrown into the generator when a workflow is cancelled.

### WorkflowRegistryInterface

```ts
type WorkflowRegistryInterface = {
  waitForPublished<T>(workflowId: string, options?: { start?: boolean; caller?: string }): Promise<T>;
  waitForCompletion<T>(workflowId: string, options?: { start?: boolean; caller?: string }): Promise<T>;
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
function createTestRuntime<T, SignalMap, WorkflowMap>(
  workflowFn: WorkflowFunction<T, SignalMap, WorkflowMap>,
  options: TestRuntimeOptions<SignalMap>,
): Promise<T>;
```

**TestRuntimeOptions:**

| Field | Type | Description |
|-------|------|-------------|
| `activities` | `Record<string, (...args) => unknown>` | Mock activity implementations |
| `signals` | `Array<{ name: K; payload: SignalMap[K] }>` | Pre-queued signals |
| `workflowResults` | `Record<string, unknown>` | Mock `join` / `published` results |

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
| `ReceiveCommand` | Wait for a signal |
| `AllCommand` | Wait for multiple items to all complete |
| `SleepCommand` | Durable timer |
| `ChildCommand` | Child workflow delegation |
| `JoinCommand` | Wait for workflow completion |
| `PublishedCommand` | Wait for workflow published value |
| `RaceCommand` | Race branches |
| `PublishCommand` | Publish a value to waiters |
| `Command` | Union of all command types |

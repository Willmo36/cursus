# react-workflow Architecture Proposal

## Core Idea

Durable workflows in the browser. A workflow is a **generator function** that yields "commands" (things it wants to happen). An **interpreter** runs the generator, executes commands, and records results in an **event log**. On page reload, the interpreter **replays** the event log through the generator to restore state — no explicit state serialization needed.

## Key Concepts

### Workflow = Generator Function

```ts
function* checkout(ctx: WorkflowContext): Workflow<OrderResult> {
  const cart = yield* ctx.activity("fetchCart", fetchCart);
  const payment = yield* ctx.receive("payment-submitted");
  const order = yield* ctx.activity("charge", () => chargeCard(payment));
  return { orderId: order.id };
}
```

Why generators:
- Natural suspension/resumption semantics — `yield` is a suspension point
- Deterministic replay — re-run the generator, feed back recorded results at each yield
- Composable — `yield*` delegates to sub-workflows naturally
- No async/await coloring problem — the interpreter decides when things are truly async
- Inspired by redux-saga, which proved generators work well for effect management in React

### Commands (what the workflow wants)

Commands are the yield values — declarative descriptions of side effects:

| Command | Purpose |
|---------|---------|
| `activity(name, fn)` | Execute a side-effecting function (API call, storage, etc.) |
| `receive(signal)` | Pause until an external signal arrives (user input, event) |
| `sleep(ms)` | Durable timer — survives page reload |
| `child(name, workflowFn)` | Start a nested/child workflow |
| `query()` | Expose current workflow state for external reads |

### Event Log (what actually happened)

An append-only, ordered log persisted to browser storage:

```ts
type Event =
  | { type: "workflow_started"; input: unknown; timestamp: number }
  | { type: "activity_scheduled"; name: string; seq: number }
  | { type: "activity_completed"; seq: number; result: unknown }
  | { type: "activity_failed"; seq: number; error: string }
  | { type: "signal_received"; name: string; payload: unknown }
  | { type: "timer_started"; seq: number; durationMs: number }
  | { type: "timer_fired"; seq: number }
  | { type: "child_started"; name: string; workflowId: string }
  | { type: "child_completed"; workflowId: string; result: unknown }
  | { type: "workflow_completed"; result: unknown }
  | { type: "workflow_failed"; error: string };
```

### Interpreter (the runtime)

The interpreter drives the generator and manages the event log:

1. **On first run:** Steps the generator, executes commands for real, appends events to the log
2. **On replay (page reload):** Steps the generator, but instead of executing commands, returns the recorded results from the event log. When the log is exhausted, switches to live execution.
3. **On signal:** Appends a signal event, resumes the generator if it was waiting for that signal

The key architectural insight: **the workflow function is a deterministic projection of the event log**. State is never serialized directly — it's reconstructed by replaying events through the workflow code.

### Storage

Pluggable storage interface:

```ts
interface WorkflowStorage {
  load(workflowId: string): Promise<Event[]>;
  append(workflowId: string, events: Event[]): Promise<void>;
  clear(workflowId: string): Promise<void>;
}
```

Default implementation: `localStorage` (simple, synchronous-ish).
Possible: IndexedDB, server-side, in-memory (for testing).

### React Integration

```ts
// The main hook
function useWorkflow<TResult>(
  workflowId: string,
  workflowFn: WorkflowFunction<TResult>,
  options?: { storage?: WorkflowStorage }
): {
  state: "running" | "completed" | "failed";
  result: TResult | undefined;
  error: Error | undefined;
  signal: (name: string, payload?: unknown) => void;
  reset: () => void;
}
```

The hook:
- Creates/resumes the interpreter on mount
- Replays the event log to catch up
- Re-renders on state changes (activity completion, signal receipt, workflow completion)
- Provides `signal()` to push data into the workflow (user interactions = signals)
- Provides `reset()` to clear the event log and restart

### Nested/Child Workflows

Child workflows have their own event logs, linked to the parent via `child_started`/`child_completed` events:

```ts
function* jobApplication(ctx: WorkflowContext): Workflow<Application> {
  const personal = yield* ctx.child("personal-info", personalInfoWorkflow);
  const education = yield* ctx.child("education", educationWorkflow);
  const review = yield* ctx.child("review", reviewWorkflow);
  return { personal, education, review };
}
```

This gives us natural "multi-step wizard" behavior. Each child workflow can be independently replayed, and the parent tracks the overall progress.

### Testing via Alternative Interpreters

The workflow function is just a generator — it doesn't know how its commands get executed. This means we can swap interpreters:

```ts
// Production: real interpreter with storage, real activity execution
const runtime = createRuntime({ storage: localStorageAdapter() });

// Test: synchronous interpreter, activities are mocked via dependency injection
const testRuntime = createTestRuntime();
const result = testRuntime.run(myWorkflow, {
  activities: {
    fetchCart: () => mockCart,
    charge: () => mockOrder,
  },
  signals: [
    { name: "payment-submitted", payload: mockPayment },
  ],
});
expect(result).toEqual({ orderId: "123" });
```

The test interpreter runs the generator synchronously, injecting results without storage or async operations.

## How the Examples Map

| Example | Workflow Features Used |
|---------|----------------------|
| SSO login | `activity` (redirect/token exchange), `receive` (callback) |
| Login before proceeding | `receive` (credentials), `activity` (auth call), conditional branching |
| Multipage job application | `child` (nested workflows per page), `signal` (browser back = signal) |
| Chat room | Long-running workflow with repeated `receive` (messages), `signal` (join/leave/message) |
| Email then password wizard | Sequential `receive` (email), then `receive` (password), `activity` (validate) |
| Cookie banner | No storage of final result — the `result` is computed from the event log history itself |

## Design Constraints

1. **No server** — everything runs in the browser. Durability comes from browser storage, not a database cluster.
2. **No task queues** — there's only one "worker" (the current tab/page).
3. **Timers are best-effort** — if the tab is closed, timers fire on next page load after the duration has elapsed. No service worker complexity.
4. **Signals = user interactions** — signals primarily come from React UI events.
5. **Simpler event types** — no workflow tasks, task queues, or scheduling/dispatch layer.
6. **No continue-as-new** — browser workflows are unlikely to hit event log size limits. If needed, we can add this later.

## Decisions

1. **`receive` does not render UI.** The workflow pauses, and the React component inspects the workflow's "waiting for" state to decide what to render. Keeps workflow functions pure.

2. **Parallel activities supported.** `yield* ctx.parallel([...])` for concurrent activities (e.g. sending analytics alongside a main operation). Adds complexity to replay logic but is needed.

3. **History compaction deferred.** Not needed for initial version.

## Algebraic Structure

The command/interpreter architecture has a precise algebraic structure. Understanding it explains why certain combinators compose correctly and identifies when they break.

### Free Monad

`Generator<Command, T, unknown>` forms a free monad over the `Command` functor. Each `yield` suspends the computation, returning a command to the interpreter. `yield*` (generator delegation) is monadic bind — it sequences two command-producing computations, threading the result of the first into the second. The interpreter is the natural transformation `Free<Command, T> → Promise<T>` that gives meaning to each command.

This is why workflows compose: `yield*` is associative, and the interpreter can be swapped (production vs. test) without changing the workflow's structure.

### Profunctor

`Workflow<SignalMap, T>` is a profunctor — contravariant in its signal input (what signals it accepts) and covariant in its result output (what value it produces). In concrete terms:

- **Covariant (result):** If workflow A returns `T`, a parent can `yield* ctx.child("a", A)` and receive `T`. Results flow out naturally.
- **Contravariant (signals):** If workflow A accepts signal `"submit"`, the parent must be able to route `"submit"` into A. Signals must flow in.

`ctx.child()` originally composed only the covariant part — the child's result flowed back to the parent, but signals sent to the parent were not forwarded to the child. This broke the profunctor structure: `yield* ctx.child("x", wf)` was not equivalent to inlining `wf` when `wf` used `receive`.

### Monad Laws

For pure computation (activities, sleep), the monad laws hold:

- **Left identity:** `yield* ctx.activity("x", f)` behaves the same whether wrapped in a child or inlined.
- **Associativity:** `yield* a; yield* b; yield* c` groups the same regardless of nesting.

**Right identity** was broken for signal-consuming workflows: `yield* ctx.child("x", wf)` ≠ running `wf` inline when `wf` uses `receive`, because signals didn't reach the child. The fix (signal delegation through `_activeChild`) restores right identity for all command types.

### Design Principle

Every combinator must preserve both directions of the profunctor. Concretely: if a workflow accepts signals, any wrapper (`child`, `race`, `on`) must route signals through to it. If a combinator drops the contravariant part, it breaks composition.

### Endomorphism Monoid (Activity Wrappers)

Activity functions have type `(AbortSignal) → Promise<T>`. Higher-order functions that transform this type to itself — `withRetry`, `withCircuitBreaker` — are endomorphisms on this carrier set. They form a monoid:

- **Carrier:** `((AbortSignal) → Promise<T>) → ((AbortSignal) → Promise<T>)`
- **Operation:** function composition via `wrapActivity(...wrappers)`, which applies wrappers left-to-right (outermost first)
- **Identity:** the empty wrapper list — `wrapActivity()` returns the original function unchanged
- **Associativity:** `wrapActivity(a, b, c)` = `wrapActivity(a, wrapActivity(b, c))`

**What belongs at the activity level (endomorphism monoid):**
- Retry logic (`withRetry`) — retries are invisible to the event log
- Circuit breaking (`withCircuitBreaker`) — failure tracking is per-activity, transparent to the workflow
- Rate limiting, fallback, caching — same principle: transparent to the workflow

**What does NOT belong here (workflow-level concerns):**
- Timeout — already handled by `ctx.race(activity, sleep)`, visible in the event log
- Cancellation — workflow-level via `cancel()` with `AbortSignal` propagation
- Orchestration — sequencing, branching, parallel execution are workflow concerns

The key invariant: all activity wrappers are transparent to the event log. The workflow sees a single `activity_completed` or `activity_failed` event regardless of how many retries or circuit breaker state transitions happened internally.

### Other Algebraic Structures

- **Natural transformation:** The interpreter is `Free<Command, T> → Promise<T>`. Swapping interpreters (production vs. test) preserves the natural transformation's commutativity with `yield*`.
- **Coalgebra:** `WorkflowState → (WorkflowState, Event[])` — the interpreter's step function is a coalgebra for the `(−) × Event[]` functor. The event log is the terminal coalgebra's trace.
- **F-algebra:** Event log replay is an F-algebra: `fold` over the event list to reconstruct workflow state. The fold is a catamorphism.
- **Applicative:** `ctx.parallel([...])` and `ctx.waitForAll([...])` give the command language applicative structure — independent effects executed concurrently.
- **Alternative:** `ctx.race(...)` and `ctx.waitForAny(...)` provide the alternative functor — choose the first effect to complete, discard the rest.

## Future Work

- **Saga/compensation pattern.** A first-class `ctx.compensate()` primitive for registering undo actions that execute in LIFO order on failure. Deferred because try/catch in generators handles basic cases, and none of the initial examples require it. Promote to a primitive if the pattern recurs.

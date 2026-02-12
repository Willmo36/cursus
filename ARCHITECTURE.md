# react-workflow Architecture Proposal

## Core Idea

Durable workflows in the browser, inspired by Temporal's execution model. A workflow is a **generator function** that yields "commands" (things it wants to happen). An **interpreter** runs the generator, executes commands, and records results in an **event log**. On page reload, the interpreter **replays** the event log through the generator to restore state — no explicit state serialization needed.

## Key Concepts

### Workflow = Generator Function

```ts
function* checkout(ctx: WorkflowContext): Workflow<OrderResult> {
  const cart = yield* ctx.activity("fetchCart", fetchCart);
  const payment = yield* ctx.waitFor("payment-submitted");
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
| `waitFor(signal)` | Pause until an external signal arrives (user input, event) |
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

This is the key architectural insight from Temporal: **the workflow function is a deterministic projection of the event log**. State is never serialized directly — it's reconstructed by replaying events through the workflow code.

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
| SSO login | `activity` (redirect/token exchange), `waitFor` (callback) |
| Login before proceeding | `waitFor` (credentials), `activity` (auth call), conditional branching |
| Multipage job application | `child` (nested workflows per page), `signal` (browser back = signal) |
| Chat room | Long-running workflow with repeated `waitFor` (messages), `signal` (join/leave/message) |
| Email then password wizard | Sequential `waitFor` (email), then `waitFor` (password), `activity` (validate) |
| Cookie banner | No storage of final result — the `result` is computed from the event log history itself |

## Deviations from Temporal

1. **No server** — everything runs in the browser. Durability comes from browser storage, not a database cluster.
2. **No task queues** — there's only one "worker" (the current tab/page).
3. **Timers are best-effort** — if the tab is closed, timers fire on next page load after the duration has elapsed. No service worker complexity.
4. **Signals = user interactions** — in Temporal, signals come from other services. Here, they primarily come from React UI events.
5. **Simpler event types** — we don't need workflow tasks, task queues, or the scheduling/dispatch layer.
6. **No continue-as-new** — browser workflows are unlikely to hit event log size limits. If needed, we can add this later.

## Decisions

1. **`waitFor` does not render UI.** The workflow pauses, and the React component inspects the workflow's "waiting for" state to decide what to render. Keeps workflow functions pure.

2. **Parallel activities supported.** `yield* ctx.parallel([...])` for concurrent activities (e.g. sending analytics alongside a main operation). Adds complexity to replay logic but is needed.

3. **History compaction deferred.** Not needed for initial version.

## Future Work

- **Saga/compensation pattern.** A first-class `ctx.compensate()` primitive for registering undo actions that execute in LIFO order on failure. Deferred because try/catch in generators handles basic cases, and none of the initial examples require it. Promote to a primitive if the pattern recurs.

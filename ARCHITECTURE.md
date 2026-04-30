# cursus Architecture

## Core Idea

Durable workflows in the browser. A workflow is a **generator function** that yields "commands" (things it wants to happen). An **interpreter** runs the generator, executes commands, and records results in an **event log**. On page reload, the interpreter **replays** the event log through the generator to restore state — no explicit state serialization needed.

## Key Concepts

### Workflow = Generator Function

```ts
const checkout = workflow(function* () {
  const cart = yield* activity("fetchCart", fetchCart);
  const payment = yield* receive<PaymentInfo>("payment-submitted");
  const order = yield* activity("charge", async () => chargeCard(payment));
  return { orderId: order.id };
});
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
| `activity(name, fn)` | Execute a side-effecting function (API call, storage, etc.). Result is serialized into the log. |
| `receive(label)` | Pause until an external `signal(label, payload)` arrives. Payload is serialized into the log. |
| `ask(label)` | Read the current output of a registered workflow. Value is recomputed live on replay; never serialized. |
| `sleep(ms)` | Durable timer — survives page reload |
| `child(name, wf)` | Start a nested/child workflow |
| `publish(value)` | Expose intermediate workflow state to consumers. Value lives in memory; log only records the marker. |
| `all(...)` | Wait for multiple branches concurrently |
| `race(...)` | Race branches, first to complete wins |
| `loop(body)` / `loopBreak(value)` | Repeat until break |

### Event Log (what actually happened)

An append-only, ordered log persisted to browser storage:

```ts
type Event =
  | { type: "workflow_started"; timestamp: number }
  | { type: "activity_scheduled"; name: string; seq: number }
  | { type: "activity_completed"; seq: number; result: unknown }   // result serialized
  | { type: "activity_failed"; seq: number; error: string }
  | { type: "receive_resolved"; label: string; value: unknown; seq: number }  // value serialized
  | { type: "ask_resolved"; label: string; seq: number }           // marker only
  | { type: "timer_started"; seq: number; durationMs: number }
  | { type: "timer_fired"; seq: number }
  | { type: "child_started"; name: string; workflowId: string }
  | { type: "child_completed"; workflowId: string; childLog: Event[] }  // embeds child's log
  | { type: "workflow_published"; seq: number }                    // marker only
  | { type: "workflow_completed" }                                 // marker only
  | { type: "workflow_failed"; error: string };
```

Only two events carry payload data: `activity_completed.result` and `receive_resolved.value`. Everything else is a marker that records *that* something happened, not the value. Published values, workflow returns, `all`/`race` results, and `loopBreak` values are recomputed in memory on replay — producers can return non-serializable shapes (services, class instances) as long as their activity/receive inputs are serializable.

### Interpreter (the runtime)

The interpreter drives the generator and manages the event log:

1. **On first run:** Steps the generator, executes commands for real, appends events to the log
2. **On replay (page reload):** Steps the generator, but instead of executing commands, returns the recorded results from the event log. When the log is exhausted, switches to live execution.
3. **On signal:** Appends a receive_resolved event and resumes the generator if it was waiting on `receive()` for that label

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
// Registry mode — the only mode
const { useWorkflow, Provider } = createBindings(registry);
const { state, published, signal, cancel, reset } = useWorkflow("checkout");
```

The registry is the runtime. All workflows are registered up front; `useWorkflow` looks them up by ID and subscribes to state changes. The hook:
- Calls `registry.start(id)` on mount (idempotent — no-op if already running)
- Subscribes to state changes via `registry.onStateChange`
- Re-renders on state changes (activity completion, signal receipt, workflow completion)
- Provides `signal()` to push data into the workflow (user interactions = signals)
- Provides `reset()` to clear the event log and restart

### Nested/Child Workflows

Child workflows have their own event logs, linked to the parent via `child_started`/`child_completed` events:

```ts
const jobApplication = workflow(function* () {
  const personal = yield* child("personal-info", personalInfoWorkflow);
  const education = yield* child("education", educationWorkflow);
  const review = yield* child("review", reviewWorkflow);
  return { personal, education, review };
});
```

This gives us natural "multi-step wizard" behavior. Each child workflow can be independently replayed, and the parent tracks the overall progress.

### Testing via Alternative Interpreters

The workflow function is just a generator — it doesn't know how its commands get executed. This means we can swap interpreters:

```ts
// Test: activities are mocked, signals are pre-queued
const result = await createTestRuntime(checkoutWorkflow, {
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
| Multipage job application | `child` (nested workflows per page), `receive` (browser back = signal) |
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

2. **Parallel activities supported.** `yield* all(...)` for concurrent branches (e.g. sending analytics alongside a main operation). Adds complexity to replay logic but is needed.

3. **No history compaction.** Completed workflows keep their full event log. Replay on remount re-runs the generator against stored activity/receive events — fast-forwarding through side effects, reproducing publish/return values live in memory. This lets workflows return non-serializable values at the cost of storage growth proportional to workflow length. SSR is the primary durability driver: the server runs the registry, serializes the event log as a snapshot, and the client seeds it into storage before mounting — the registry replays and hydrates without loading flashes or duplicate activity calls.

## Algebraic Structure

The command/interpreter architecture has a precise algebraic structure. Understanding it explains why certain combinators compose correctly and identifies when they break.

### Free Monad

`Generator<Command, T, unknown>` forms a free monad over the `Command` functor. Each `yield` suspends the computation, returning a command to the interpreter. `yield*` (generator delegation) is monadic bind — it sequences two command-producing computations, threading the result of the first into the second. The interpreter is the natural transformation `Free<Command, T> → Promise<T>` that gives meaning to each command.

This is why workflows compose: `yield*` is associative, and the interpreter can be swapped (production vs. test) without changing the workflow's structure.

### Profunctor

`Workflow<A, R>` is a profunctor — contravariant in its requirements input (what queries it needs) and covariant in its result output (what value it produces). In concrete terms:

- **Covariant (result):** If workflow A returns `T`, a parent can `yield* child("a", A)` and receive `T`. The `.map()` combinator transforms the output.
- **Contravariant (requirements):** If workflow A needs `Receives<"submit", string>`, the parent inherits that requirement. The `.provide()` combinator satisfies requirements.

`child()` composes both directions — the child's result flows to the parent, and signals sent to the parent are forwarded to active children. This preserves the profunctor structure: `yield* child("x", wf)` is equivalent to inlining `wf`.

### Monad Laws

For pure computation (activities, sleep), the monad laws hold:

- **Left identity:** `yield* activity("x", f)` behaves the same whether wrapped in a child or inlined.
- **Associativity:** `yield* a; yield* b; yield* c` groups the same regardless of nesting.

Signal delegation through `_activeChild` ensures right identity holds for all command types, including signal-consuming workflows.

### Design Principle

Every combinator must preserve both directions of the profunctor. Concretely: if a workflow accepts signals, any wrapper (`child`, `race`, `on`) must route signals through to it. If a combinator drops the contravariant part, it breaks composition.

### Other Algebraic Structures

- **Natural transformation:** The interpreter is `Free<Command, T> → Promise<T>`. Swapping interpreters (production vs. test) preserves the natural transformation's commutativity with `yield*`.
- **Coalgebra:** `WorkflowState → (WorkflowState, Event[])` — the interpreter's step function is a coalgebra for the `(−) × Event[]` functor. The event log is the terminal coalgebra's trace.
- **F-algebra:** Event log replay is an F-algebra: `fold` over the event list to reconstruct workflow state. The fold is a catamorphism.
- **Applicative:** `all(...)` gives the command language applicative structure — independent effects executed concurrently.
- **Alternative:** `race(...)` provides the alternative functor — choose the first effect to complete, discard the rest.

## Future Work

- **Saga/compensation pattern.** A first-class compensation primitive for registering undo actions that execute in LIFO order on failure. Deferred because try/catch in generators handles basic cases, and none of the initial examples require it. Promote to a primitive if the pattern recurs.

---
sidebar_position: 2
---

# Workflows

A workflow is a generator function that yields commands through the `WorkflowContext`. Every `yield*` is a durable checkpoint — the engine records events so it can replay past steps on reload without re-executing them.

```ts
import type { WorkflowFunction } from "react-workflow";

const myWorkflow: WorkflowFunction<ResultType, SignalMap, WorkflowMap, QueryMap> = function* (ctx) {
  // ...
};
```

The type parameters are:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `ResultType` | required | The workflow's return type |
| `SignalMap` | `Record<string, unknown>` | Maps signal names to payload types |
| `WorkflowMap` | `Record<string, never>` | Maps workflow IDs to result types (for cross-workflow deps) |
| `QueryMap` | `Record<string, never>` | Maps query names to return types |
| `PublishType` | `never` | The type of value this workflow can publish (uncallable when `never`) |

## Activities

Activities are async side effects — API calls, computations, anything that shouldn't run twice on replay.

```ts
const result = yield* ctx.activity("fetch-user", async (signal) => {
  const res = await fetch("/api/user", { signal });
  return res.json();
});
```

The activity function receives an `AbortSignal` that fires on workflow cancellation.

On replay, the engine returns the stored result without calling the function again.

## Signals

Signals are how the UI pushes data into the workflow. The workflow pauses until the signal arrives.

### waitFor

Wait for a single named signal:

```ts
const email = yield* ctx.waitFor<string>("email");
```

### waitForAll

Wait for multiple signals (and/or workflow results) to all arrive. Returns a tuple in order:

```ts
const [email, password] = yield* ctx.waitForAll("email", "password");
```

You can mix signals with workflow references (see [Layers](./layers.md)):

```ts
const [payment, profile] = yield* ctx.waitForAll(
  "payment",
  ctx.workflow("profile"),
);
```

### waitForAny

Wait for the first of several signals. Returns which signal fired:

```ts
const { signal, payload } = yield* ctx.waitForAny("accept", "reject");

if (signal === "accept") {
  // ...
}
```

## Sleep

Pause the workflow for a duration. Durable — survives page reloads:

```ts
yield* ctx.sleep(5000); // 5 seconds
```

## Parallel

Run multiple activities concurrently. All must complete:

```ts
const [users, posts] = yield* ctx.parallel([
  { name: "fetch-users", fn: async () => fetchUsers() },
  { name: "fetch-posts", fn: async () => fetchPosts() },
]);
```

## Child Workflows

Delegate to a sub-workflow via `yield*`. The child runs in the same interpreter with its own event log scope:

```ts
const childResult = yield* ctx.child("validate", validationWorkflow);
```

Activity mocks propagate into children during testing.

## Race

Race multiple branches — the first to complete wins, others are discarded:

```ts
const { winner, value } = yield* ctx.race(
  ctx.activity("fetch", async (signal) => {
    const res = await fetch("/api/slow", { signal });
    return res.json();
  }),
  ctx.sleep(5000),
);

if (winner === 0) {
  // fetch won
} else {
  // timeout
}
```

The losing branch's `AbortSignal` is triggered, so you can clean up in-flight requests.

### Escalation with Race

A common pattern is racing a signal against a timeout — for example, waiting for a manager's approval and escalating if it doesn't arrive in time:

```ts
const approval: WorkflowFunction<"approved" | "escalated", { approve: string }> =
  function* (ctx) {
    const { winner, value } = yield* ctx.race(
      ctx.waitFor("approve"),
      ctx.sleep(24 * 60 * 60 * 1000), // 24 hours
    );

    if (winner === 0) {
      return "approved";
    }

    // Timeout — escalate to next level
    yield* ctx.activity("escalate", async () => {
      await fetch("/api/escalate", { method: "POST" });
    });
    return "escalated";
  };
```

The signal and sleep are both durable — if the user refreshes, the remaining timeout resumes from where it left off and any signal already received replays instantly.

## Signal Loops with on/done

For workflows that handle multiple signals in a loop (like a shopping cart), use `on` with `done`:

```ts
const finalCount = yield* ctx.on<number>({
  increment: function* () {
    count++;
  },
  decrement: function* () {
    count--;
  },
  checkout: function* (ctx) {
    yield* ctx.done(count);
  },
});
```

`on` blocks the workflow and dispatches incoming signals to the matching handler. The workflow stays in the loop until a handler calls `ctx.done(value)`, which terminates the loop and returns the value.

## Queries

Queries let the UI read workflow-internal state without signals:

```ts
const workflow: WorkflowFunction<string, SignalMap, never, { count: number }> =
  function* (ctx) {
    let count = 0;
    ctx.query("count", () => count);

    // count changes as the workflow progresses...
    count++;
    const data = yield* ctx.waitFor("submit");
    count++;
    return data;
  };
```

The UI reads it via the hook:

```tsx
const { query } = useWorkflow("my-wf", workflow);
const count = query("count"); // reactive, updates on state changes
```

Queries are not persisted — they're computed from the live workflow state.

## Publish

`publish` lets a workflow provide a value to consumers while continuing to run. This is useful for long-lived workflows that produce an intermediate result — like a session workflow that publishes the user account on login but keeps running to handle revocation.

```ts
const sessionWorkflow: WorkflowFunction<
  void,
  { login: { user: string } },
  Record<string, never>,
  Record<string, never>,
  { user: string } // PublishType — 5th type parameter
> = function* (ctx) {
  const { user } = yield* ctx.waitFor("login");
  yield* ctx.publish({ user });

  // Workflow keeps running after publish
  yield* ctx.waitFor("login"); // wait for re-auth, revocation, etc.
};
```

When a workflow publishes:

- All current `waitForWorkflow` callers resolve immediately with the published value
- Future `waitForWorkflow` calls return the published value without waiting
- The workflow generator continues executing

The 5th type parameter on `WorkflowFunction` controls the publish type. When omitted (defaults to `never`), `ctx.publish` is uncallable — you get a type error if you try to use it.

On replay, the publish event replays from the event log without calling the registry.

## Error Handling

Workflows support standard try/catch. If an activity throws, the error propagates through the generator:

```ts
try {
  const data = yield* ctx.activity("risky", async () => {
    throw new Error("boom");
  });
} catch (err) {
  const fallback = yield* ctx.activity("recover", async () => "safe value");
  return fallback;
}
```

Uncaught errors put the workflow in the `"failed"` state with the error message available via `useWorkflow().error`.

## Cancellation

Workflows can be cancelled programmatically. In-flight activities receive an abort signal:

```ts
const { cancel } = useWorkflow("my-wf", workflow);

// Later:
cancel();
```

A cancelled workflow enters the `"cancelled"` state. You can catch `CancelledError` inside the workflow if you need cleanup logic.

## Type Safety

`WorkflowFunction` is fully generic. TypeScript enforces that:

- `signal("name", payload)` matches your `SignalMap`
- `waitForWorkflow("id")` matches your `WorkflowMap`
- `query("name")` matches your `QueryMap`
- The return type flows through to `useWorkflow().result`

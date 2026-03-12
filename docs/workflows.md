---
sidebar_position: 2
---

# Workflows

A workflow is a generator function that yields commands via free functions. Every `yield*` is a durable checkpoint — the engine records events so it can replay past steps on reload without re-executing them.

```ts
import { workflow, activity, receive, sleep } from "cursus";

const myWorkflow = workflow(function* () {
  // ...
});
```

## Activities

Activities are async side effects — API calls, computations, anything that shouldn't run twice on replay.

```ts
const result = yield* activity("fetch-user", async (signal) => {
  const res = await fetch("/api/user", { signal });
  return res.json();
});
```

The activity function receives an `AbortSignal` that fires on workflow cancellation.

On replay, the engine returns the stored result without calling the function again.

## Signals

Signals are how the UI pushes data into the workflow. The workflow pauses until the signal arrives.

### receive

Wait for a single named signal:

```ts
const email = yield* receive<string>("email");
```

### all

Wait for multiple signals, workflow results, or activities to all complete. Returns a tuple in order:

```ts
const [email, password] = yield* all(receive("email"), receive("password"));
```

You can mix signals with workflow dependencies (see [Layers](./layers.md)):

```ts
const [payment, profile] = yield* all(receive("payment"), join("profile"));
```

Run multiple activities concurrently:

```ts
const [users, posts] = yield* all(
  activity("fetch-users", async () => fetchUsers()),
  activity("fetch-posts", async () => fetchPosts()),
);
```

## Sleep

Pause the workflow for a duration. Durable — survives page reloads:

```ts
yield* sleep(5000); // 5 seconds
```

## Child Workflows

Delegate to a sub-workflow via `child`. The child runs in the same interpreter with its own event log scope:

```ts
const childResult = yield* child("validate", validationWorkflow);
```

Activity mocks propagate into children during testing.

## Race

Race multiple branches — the first to complete wins, others are discarded. Works with signals, activities, sleeps, or any combination:

```ts
// Race signals — first signal wins
const { winner, value } = yield* race(receive("accept"), receive("reject"));

if (winner === 0) {
  // accepted
} else {
  // rejected
}
```

```ts
// Race an activity against a timeout
const { winner, value } = yield* race(
  activity("fetch", async (signal) => {
    const res = await fetch("/api/slow", { signal });
    return res.json();
  }),
  sleep(5000),
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
const approval = workflow(function* () {
  const { winner, value } = yield* race(
    receive("approve"),
    sleep(24 * 60 * 60 * 1000), // 24 hours
  );

  if (winner === 0) {
    return "approved";
  }

  // Timeout — escalate to next level
  yield* activity("escalate", async () => {
    await fetch("/api/escalate", { method: "POST" });
  });
  return "escalated";
});
```

The signal and sleep are both durable — if the user refreshes, the remaining timeout resumes from where it left off and any signal already received replays instantly.

## Signal Loops with handle

For workflows that handle multiple signals in a loop (like a shopping cart), use `handle`:

```ts
const finalCount = yield* handle<number>({
  increment: function* (payload, done) {
    count++;
  },
  decrement: function* (payload, done) {
    count--;
  },
  checkout: function* (payload, done) {
    yield* done(count);
  },
});
```

`handle` blocks the workflow and dispatches incoming signals to the matching handler. The workflow stays in the loop until a handler calls `done(value)`, which terminates the loop and returns the value.

## Publish

`publish` lets a workflow provide a value to consumers while continuing to run. This is useful for long-lived workflows that produce an intermediate result — like a session workflow that publishes the user account on login but keeps running to handle revocation.

```ts
const sessionWorkflow = workflow(function* () {
  const { user } = yield* receive("login");
  yield* publish({ user });

  // Workflow keeps running after publish
  yield* receive("login"); // wait for re-auth, revocation, etc.
});
```

When a workflow publishes:

- All current `published` callers resolve immediately with the published value
- Future `published` calls return the published value without waiting
- The workflow generator continues executing

On replay, the publish event replays from the event log without calling the registry.

### When to use `return` vs `publish`

- **Does your workflow have a definitive end state?** Use `return`. The workflow completes and consumers get the final value via `join` or `state.result`.
- **Does your workflow need to provide a value but keep running?** Use `publish`. Consumers get the value immediately via `published`, and the workflow continues handling signals (upgrades, revocation, live updates, etc.).
- **Can you publish multiple times?** Yes. Each `yield* publish(value)` updates the value for future `published` callers and resolves any currently waiting consumers.
- **Can a workflow both publish and return?** Yes. `publish` provides an intermediate value while the workflow is alive. `return` ends the workflow. Once a workflow returns, `join` resolves with the completed value.

## Error Handling

Workflows support standard try/catch. If an activity throws, the error propagates through the generator:

```ts
try {
  const data = yield* activity("risky", async () => {
    throw new Error("boom");
  });
} catch (err) {
  const fallback = yield* activity("recover", async () => "safe value");
  return fallback;
}
```

Uncaught errors put the workflow in the `"failed"` state with the error message available via `state.error`.

## Cancellation

Workflows can be cancelled programmatically. In-flight activities receive an abort signal:

```ts
const { cancel } = useWorkflow("my-wf", myWorkflow);

// Later:
cancel();
```

A cancelled workflow enters the `"cancelled"` state. You can catch `CancelledError` inside the workflow if you need cleanup logic.

## Type Safety

Signal types are inferred from the workflow function via `SignalMapOf`. TypeScript enforces that:

- `signal("name", payload)` matches the signals used by the workflow
- `join("id")` and `published("id")` match the workflow's dependency declarations
- The return type flows through to `state.result`

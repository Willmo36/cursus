---
sidebar_position: 2
---

# Workflows

A workflow is a generator function that yields commands via free functions. Every `yield*` is a durable checkpoint — the engine records events so it can replay past steps on reload without re-executing them.

```ts
import { workflow, activity, ask, receive, sleep } from "cursus";

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

On replay, the engine returns the stored result without calling the function again. Because the result is serialized into the event log, the return type `T` is constrained to JSON-serializable shapes — the compiler rejects non-serializable types like functions, `Map`, or class instances.

## Pulling values into a workflow

Two primitives move data from the outside world into a workflow. They look similar but have very different replay semantics, and you pick one based on where the value comes from.

### receive — wait for an external signal

`receive(label)` pauses the workflow until an external caller delivers a value with that label (typically via the `signal()` method on the hook). The payload is recorded verbatim in the event log so replay can reproduce exactly what the user did.

```ts
const email = yield* receive<string>("email");
```

Because `receive()` payloads are logged, the type parameter must be JSON-serializable (primitives, plain objects, arrays, `Date`). Functions, `Map`, `Set`, and class instances are rejected at the type level.

### ask — read another workflow's output

`ask(label)` resolves from a registered workflow's published value or return value. The marker is logged for replay ordering, but **the value itself is never serialized** — on replay, the registry re-runs the producing workflow and yields its current value live.

```ts
const services = yield* ask("api-services").as<ApiServices>();
```

This means `ask()` values can be anything — service bundles with methods, class instances, closures, whatever. The producing workflow is responsible for constructing them deterministically from its own logged inputs.

### Picking between them

- Value comes from a UI button, form, or any external event → **`receive`**.
- Value comes from another workflow in your registry → **`ask`**.

### all — wait for several at once

Wait for multiple branches (`receive`, `ask`, `activity`, etc.) to all complete. Returns a tuple in order:

```ts
const [email, password] = yield* all(receive("email"), receive("password"));
```

Mix and match with other primitives:

```ts
const [payment, profile] = yield* all(
  receive("payment"),
  ask("profile"),
);
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

Race multiple branches — the first to complete wins, others are discarded. Works with queries, activities, sleeps, or any combination:

```ts
// Race two signals — first to arrive wins
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

The receive and sleep are both durable — if the user refreshes, the remaining timeout resumes from where it left off and any signal already received replays instantly.

## Signal Loops with handler

For workflows that handle multiple signals in a loop (like a shopping cart), use `handler()`:

```ts
const finalCount = yield* handler()
  .on("increment", function* () {
    count++;
  })
  .on("decrement", function* () {
    count--;
  })
  .on("checkout", function* (_payload, done) {
    yield* done(count);
  })
  .as<number>();
```

`handler()` blocks the workflow and dispatches incoming signals to the matching handler. The workflow stays in the loop until a handler calls `done(value)`, which terminates the loop and returns the value.

## Publish

`publish` lets a workflow provide a value to consumers while continuing to run. This is useful for long-lived workflows that produce an intermediate result — like a session workflow that publishes the user account on login but keeps running to handle revocation.

```ts
const sessionWorkflow = workflow(function* () {
  const { user } = yield* receive("login").as<{ user: string }>();
  yield* publish({ user });

  // Workflow keeps running after publish
  yield* receive("revoke"); // wait for revocation
});
```

When a workflow publishes:

- All current `ask()` callers for this workflow resolve immediately with the published value
- Future `ask()` calls return the published value without waiting
- The workflow generator continues executing

The published value is **not serialized to the event log** — only a marker is recorded. On replay, the workflow re-runs from its own activity and receive history and re-yields the same publish call, reproducing the live value in memory. This means `publish()` accepts any shape, including non-serializable values like service bundles with methods, as long as the workflow can reconstruct them deterministically from its logged inputs.

### When to use `return` vs `publish`

- **Does your workflow have a definitive end state?** Use `return`. The workflow completes and consumers get the final value via `ask()` or `state.result`.
- **Does your workflow need to provide a value but keep running?** Use `publish`. Consumers get the value immediately via `ask()`, and the workflow continues handling signals (upgrades, revocation, live updates, etc.).
- **Can you publish multiple times?** Yes. Each `yield* publish(value)` updates the value for future `ask()` callers and resolves any currently waiting consumers.
- **Can a workflow both publish and return?** Yes. `publish` provides an intermediate value while the workflow is alive. `return` ends the workflow. Once a workflow returns, `ask()` resolves with the completed value.

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

Receive types are inferred from the workflow function via `ReceiveMapOf`. TypeScript enforces that:

- `signal("name", payload)` on the hook matches the labels the workflow receives
- `receive()` payloads are JSON-serializable — non-serializable types produce a compile-time error on `.as<V>()`
- `activity<T>()` returns are JSON-serializable
- Cross-workflow `ask("id")` labels match the registry
- The return type flows through to `state.result`

`ask()` values have no serializability constraint — they can be anything.

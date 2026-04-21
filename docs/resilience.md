---
sidebar_position: 6
---

# Resilience

cursus workflows are generators, so standard try/catch works naturally. Combined with `loop`, `loopBreak`, and `sleep`, you can build retry and error recovery patterns directly in workflow code.

## Retry with try/catch in a loop

```ts
import { activity, loop, loopBreak, sleep, workflow } from "cursus";

const fetchWorkflow = workflow(function* () {
  const data = yield* loop(function* () {
    try {
      const result = yield* activity("fetch-data", async (signal) => {
        const res = await fetch("/api/data", { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      });
      yield* loopBreak(result);
    } catch {
      yield* sleep(1000);
    }
  });

  return data;
});
```

Each iteration of the loop attempts the activity. On failure, the workflow sleeps before retrying. On success, `loopBreak` exits the loop with the result.

## Bounded retries

To limit attempts, track a counter in the loop body:

```ts
const data = yield* loop(function* () {
  attempt++;
  try {
    const result = yield* activity("fetch-data", fetchFn);
    yield* loopBreak(result);
  } catch (e) {
    if (attempt >= 3) throw e; // Give up after 3 attempts
    yield* sleep(1000 * attempt); // Linear backoff
  }
});
```

## Error recovery across workflows

When one workflow depends on another via `ask()`, failures propagate as exceptions. The consuming workflow can catch and handle them:

```ts
const orderWorkflow = workflow(function* () {
  const shipping = yield* ask("shipping").as<ShippingInfo>();
  try {
    const receipt = yield* ask("payment").as<Receipt>();
    return { status: "confirmed", ...shipping, ...receipt };
  } catch (e) {
    return {
      status: "payment-failed",
      ...shipping,
      error: e instanceof Error ? e.message : String(e),
    };
  }
});
```

## Interaction with replay

Activities are replayed by returning the stored result, not by re-running the function. If an activity succeeded on the original execution, it won't be retried on replay — the stored result is returned immediately.

If an activity *failed* and the workflow caught the error and retried via the loop, the retry attempts are each recorded as separate activity events. On replay, each attempt replays in order.

---
sidebar_position: 6
---

# Resilience

cursus provides higher-order functions that wrap activity functions with retry and circuit breaker logic. These wrappers are transparent to the event log — they compose around the `(AbortSignal) => Promise<T>` signature that activities already use.

## withRetry

Retries a failed activity with configurable backoff:

```ts
import { withRetry } from "cursus";

const result = yield* ctx.activity(
  "fetch-data",
  withRetry(
    async (signal) => {
      const res = await fetch("/api/data", { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    { maxAttempts: 3, backoff: "exponential", initialDelayMs: 1000 },
  ),
);
```

### RetryPolicy

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxAttempts` | `number` | `3` | Total attempts (including the first) |
| `backoff` | `"fixed" \| "linear" \| "exponential"` | `"exponential"` | Delay strategy between retries |
| `initialDelayMs` | `number` | `1000` | Base delay in milliseconds |
| `maxDelayMs` | `number` | `30000` | Maximum delay cap |

**Backoff strategies:**

- `"fixed"` — always `initialDelayMs`
- `"linear"` — `initialDelayMs * (attempt + 1)`
- `"exponential"` — `initialDelayMs * 2^attempt`

All strategies are capped at `maxDelayMs`.

Retries respect the `AbortSignal` — if the workflow is cancelled during a retry delay, the delay aborts immediately.

## withCircuitBreaker

Prevents repeated calls to a failing service. After enough failures, the circuit opens and calls fail immediately with `CircuitOpenError`:

```ts
import { withCircuitBreaker, CircuitOpenError } from "cursus";

const fetchWithBreaker = withCircuitBreaker(
  async (signal) => {
    const res = await fetch("/api/flaky", { signal });
    return res.json();
  },
  { failureThreshold: 5, resetTimeoutMs: 30000 },
);

try {
  const result = yield* ctx.activity("fetch", fetchWithBreaker);
} catch (err) {
  if (err instanceof CircuitOpenError) {
    // Circuit is open — service is down, don't retry
  }
}
```

### CircuitBreakerPolicy

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `failureThreshold` | `number` | `5` | Consecutive failures before opening |
| `resetTimeoutMs` | `number` | `30000` | Time before trying again (half-open) |

**Circuit states:**

1. **Closed** — calls pass through normally. Failures increment a counter.
2. **Open** — all calls throw `CircuitOpenError` immediately. After `resetTimeoutMs`, transitions to half-open.
3. **Half-open** — one call is allowed through. Success closes the circuit; failure re-opens it.

## Composing Wrappers

`wrapActivity` composes multiple wrappers into one. Wrappers apply right-to-left (innermost first):

```ts
import { wrapActivity, withRetry, withCircuitBreaker } from "cursus";

const resilient = wrapActivity(
  withCircuitBreaker,  // outer: stops calling if service is down
  withRetry,           // inner: retries transient failures
);

const result = yield* ctx.activity(
  "fetch",
  resilient(async (signal) => {
    const res = await fetch("/api/data", { signal });
    return res.json();
  }),
);
```

In this example, each call is retried up to 3 times. If enough retried calls still fail, the circuit opens.

### ActivityWrapper Type

The `ActivityWrapper` type is the common signature for all wrappers:

```ts
type ActivityWrapper = <T>(
  fn: (signal: AbortSignal) => Promise<T>,
) => (signal: AbortSignal) => Promise<T>;
```

You can write your own wrappers that conform to this type:

```ts
const withLogging: ActivityWrapper = (fn) => async (signal) => {
  console.log("starting activity");
  const result = await fn(signal);
  console.log("activity completed");
  return result;
};

const wrapped = wrapActivity(withLogging, withRetry);
```

## Interaction with Replay

Retry and circuit breaker logic runs inside the activity function. Since activities are replayed by returning the stored result (not by re-running the function), retries only happen on the original execution — not on replay.

This means the event log records a single `activity_scheduled` / `activity_completed` pair regardless of how many retries occurred internally.

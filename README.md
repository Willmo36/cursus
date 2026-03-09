# cursus

**Workflows, not reducers.**

Durable workflows for JavaScript. Write multi-step flows as generator functions. State survives page reloads via event-sourcing replay — no manual serialization needed.

```
npm install cursus
```

React bindings available via `cursus/react`. Devtools via `cursus/devtools`.

## Quick Example

Define a workflow as a generator function:

```ts
import type { WorkflowFunction } from "cursus";

type Signals = { credentials: { username: string; password: string } };
type Result = { displayName: string };

const loginWorkflow: WorkflowFunction<Result, Signals> = function* (ctx) {
  // Pause until the user submits credentials
  const creds = yield* ctx.waitFor("credentials");

  // Run a side effect — result is recorded in the event log
  const user = yield* ctx.activity("authenticate", async () => {
    const res = await fetch("/api/login", {
      method: "POST",
      body: JSON.stringify(creds),
    });
    return res.json();
  });

  return { displayName: user.name };
};
```

Use it in a component:

```tsx
import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";

const storage = new LocalStorage();

function LoginPage() {
  const { state, result, waitingFor, signal, reset } = useWorkflow(
    "login",
    loginWorkflow,
    { storage },
  );

  if (state === "waiting" && waitingFor === "credentials") {
    return <LoginForm onSubmit={(creds) => signal("credentials", creds)} />;
  }
  if (state === "running") return <p>Authenticating...</p>;
  if (state === "completed") {
    return (
      <div>
        <p>Welcome, {result.displayName}!</p>
        <button onClick={reset}>Log Out</button>
      </div>
    );
  }
}
```

Close the tab, reopen it — the workflow resumes exactly where it left off.

## Why Generators?

- **Natural suspension** — `yield` is a suspension point. No state machines, no reducer boilerplate.
- **Deterministic replay** — re-run the generator, feed back recorded results at each yield. State is reconstructed, never serialized.
- **Composable** — `yield*` delegates to sub-workflows. Multi-step wizards are just function calls.
- **Testable** — the generator doesn't know how commands get executed. Swap in mocks with `createTestRuntime`.

## Features

- **Durable execution** — event-sourced replay survives page reloads
- **Signals** — `waitFor`, `waitForAll`, `waitForAny` for UI-to-workflow communication
- **Activities** — async side effects with automatic replay skipping
- **Timers** — durable `sleep` that survives reloads
- **Parallel & Race** — concurrent activities and first-to-complete racing
- **Child workflows** — compose via `yield*` delegation
- **Cross-workflow dependencies** — `waitForWorkflow` with circular dependency detection
- **Signal loops** — `on`/`done` for long-running interactive workflows
- **Queries** — read workflow-internal state from the UI
- **Layers** — share workflows across the component tree via React context
- **Versioning** — version-stamp workflows to detect and wipe stale event logs
- **Resilience** — `withRetry`, `withCircuitBreaker`, composable `wrapActivity`
- **Testing** — `createTestRuntime` with mock activities and pre-queued signals
- **Observability** — `WorkflowEventObserver`, `useWorkflowEvents`, built-in `WorkflowDebugPanel`
- **Type-safe** — fully generic `WorkflowFunction` with typed signals, queries, and workflow deps

## API Overview

### Workflow Context

Commands available inside a workflow generator via `ctx`:

| Command | Description |
|---------|-------------|
| `activity(name, fn)` | Execute a side effect (API call, computation). Result is recorded. |
| `waitFor(signal)` | Pause until a named signal arrives from the UI. |
| `waitForAny(...signals)` | Pause until any of several signals arrives. |
| `waitForAll(...items)` | Wait for multiple signals and/or workflow results in parallel. |
| `sleep(ms)` | Durable timer — survives page reload. |
| `parallel(activities)` | Run multiple activities concurrently. |
| `child(name, fn)` | Run a nested sub-workflow with its own event log. |
| `waitForWorkflow(id)` | Block until another registered workflow completes. |
| `race(...branches)` | Race concurrent branches, cancel the losers. |
| `on(handlers)` / `done(value)` | Event-loop style signal handling. |
| `query(name, handler)` | Expose live workflow state for external reads. |

### useWorkflow Hook

```ts
const {
  state,          // "running" | "waiting" | "completed" | "failed" | "cancelled"
  result,         // T | undefined
  error,          // string | undefined
  waitingFor,     // current signal name, if waiting on waitFor
  waitingForAll,  // signal names, if waiting on waitForAll
  waitingForAny,  // signal names, if waiting on waitForAny
  signal,         // (name, payload) => void — send data into the workflow
  query,          // (name) => value — read live query state
  cancel,         // () => void — cancel with AbortSignal propagation
  reset,          // () => void — clear event log and restart
} = useWorkflow(id, workflowFn, { storage, version?, onEvent? });
```

### Cross-Workflow Dependencies

Register multiple workflows and let them depend on each other:

```tsx
import { createLayer } from "cursus";
import { WorkflowLayerProvider, useWorkflow } from "cursus/react";

const layer = createLayer(
  { profile: profileWorkflow, checkout: checkoutWorkflow },
  new LocalStorage(),
  { versions: { checkout: 2 } },  // optional versioning
);

function App() {
  return (
    <WorkflowLayerProvider layer={layer}>
      <ProfilePage />
      <CheckoutPage />
    </WorkflowLayerProvider>
  );
}

// Inside checkoutWorkflow:
function* (ctx) {
  const profile = yield* ctx.waitForWorkflow("profile");
  // ...
}
```

Circular dependencies are detected and throw immediately with a descriptive error.

### Resilience

Wrap any activity function with automatic retry and backoff:

```ts
import { withRetry } from "cursus";

const result = yield* ctx.activity(
  "fetchData",
  withRetry(async (signal) => fetch("/api/data", { signal }), {
    maxAttempts: 3,
    backoff: "exponential",
    initialDelayMs: 1000,
  }),
);
```

Fail fast when a service is repeatedly failing:

```ts
import { withCircuitBreaker } from "cursus";

const result = yield* ctx.activity(
  "fetchData",
  withCircuitBreaker(async (signal) => fetch("/api/data", { signal }), {
    failureThreshold: 5,
    resetTimeoutMs: 30000,
  }),
);
```

Compose multiple wrappers with `wrapActivity`:

```ts
import { withRetry, withCircuitBreaker, wrapActivity } from "cursus";

const resilient = wrapActivity(
  withCircuitBreaker,  // outer
  withRetry,           // inner
);

const result = yield* ctx.activity("fetchData", resilient(fetchData));
```

### Testing

Test workflows without React, storage, or real async:

```ts
import { createTestRuntime } from "cursus";

const result = await createTestRuntime(loginWorkflow, {
  activities: {
    authenticate: () => ({ name: "Alice" }),
  },
  signals: [
    { name: "credentials", payload: { username: "alice", password: "secret" } },
  ],
});

expect(result).toEqual({ displayName: "Alice" });
```

### Storage

| Implementation | Use Case |
|---------------|----------|
| `LocalStorage` | Browser persistence (survives reload) |
| `MemoryStorage` | Tests, ephemeral workflows |
| Custom `WorkflowStorage` | Implement `load`, `append`, `compact`, `clear` for any backend |

## Documentation

**[Read the docs →](https://willmo36.github.io/react-workflow/docs/)**

- [Getting Started](./docs/getting-started.md)
- [Workflows](./docs/workflows.md) — the `WorkflowContext` API
- [Layers](./docs/layers.md) — shared workflows and cross-workflow dependencies
- [Storage](./docs/storage.md) — persistence and versioning
- [Testing](./docs/testing.md) — `createTestRuntime`
- [Resilience](./docs/resilience.md) — retry and circuit breaker
- [Observability](./docs/observability.md) — event observers and debug panel
- [API Reference](./docs/api-reference.md) — exhaustive type and export reference

## Examples

The `examples/` directory contains runnable Vite apps:

| Example | Demonstrates |
|---------|-------------|
| `login` | Credential validation with retry loop |
| `sso-login` | OAuth-style token exchange |
| `wizard` | Sequential multi-step form |
| `job-application` | Nested child workflows |
| `checkout` | Cross-workflow dependencies with `waitForAll` |
| `shop` | Multi-workflow layer with queries and error simulation |
| `chat-room` | Long-running `on`/`done` loop |
| `cookie-banner` | Result derived from event history |
| `env-config` | Workflow as environment provider |
| `error-recovery` | `withRetry` and dependency failure handling |
| `race` | Fetch-with-timeout via `race` |
| `opentelemetry` | Event observer integration |

```
cd examples/login
npm install
npm run dev
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design — event sourcing model, replay mechanics, and design constraints.

## Inspiration

- [Temporal](https://temporal.io) — durable execution model and event-sourced replay
- [redux-saga](https://redux-saga.js.org) — generators as an effect management pattern in React
- [React Query](https://tanstack.com/query) — declarative async state with automatic cache management

## License

[MIT](./LICENSE)

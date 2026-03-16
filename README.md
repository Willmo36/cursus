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
import { workflow, query, activity } from "cursus";

const loginWorkflow = workflow(function* () {
  // Pause until the user submits credentials
  const creds = yield* query<{ username: string; password: string }>("credentials");

  // Run a side effect — result is recorded in the event log
  const user = yield* activity("authenticate", async () => {
    const res = await fetch("/api/login", {
      method: "POST",
      body: JSON.stringify(creds),
    });
    return res.json();
  });

  return { displayName: user.name };
});
```

Use it in a component:

```tsx
import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";

const storage = new LocalStorage();

function LoginPage() {
  const { state, signal, reset } = useWorkflow("login", loginWorkflow, { storage });

  if (state.status === "waiting") {
    return <LoginForm onSubmit={(creds) => signal("credentials", creds)} />;
  }
  if (state.status === "running") return <p>Authenticating...</p>;
  if (state.status === "completed") {
    return (
      <div>
        <p>Welcome, {state.result.displayName}!</p>
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
- **Queries** — `query` for UI-to-workflow communication
- **Activities** — async side effects with automatic replay skipping
- **Timers** — durable `sleep` that survives reloads
- **all & race** — concurrent branches with `all()` and first-to-complete `race()`
- **Child workflows** — compose via `yield*` delegation
- **Cross-workflow dependencies** — `join` / `published` with circular dependency detection
- **Signal loops** — `handle` for long-running interactive workflows
- **Publish** — expose intermediate workflow state to consumers
- **Layers** — share workflows across the component tree via React context
- **Versioning** — version-stamp workflows to detect and wipe stale event logs
- **Resilience** — `withRetry`, `withCircuitBreaker`, composable `wrapActivity`
- **Testing** — `createTestRuntime` with mock activities and pre-queued signals
- **SSR** — `runWorkflow` for server-side execution, snapshot hydration via `useWorkflow`
- **Observability** — `WorkflowEventObserver`, `useWorkflowEvents`, built-in `WorkflowDebugPanel`
- **Type-safe** — query types inferred from workflow definition

## API Overview

### Workflow Commands

Free functions yielded inside a workflow generator:

| Command | Description |
|---------|-------------|
| `activity(name, fn)` | Execute a side effect (API call, computation). Result is recorded. |
| `query(label)` | Pause until a named query is resolved from the UI. |
| `sleep(ms)` | Durable timer — survives page reload. |
| `all(...branches)` | Wait for multiple branches concurrently, return all results. |
| `race(...branches)` | Race concurrent branches, cancel the losers. |
| `child(name, fn)` | Run a nested sub-workflow with its own event log. |
| `join(id)` | Block until another registered workflow completes. |
| `published(id)` | Block until another registered workflow publishes a value. |
| `handle(handlers)` | Event-loop style signal handling with `done()` to exit. |
| `publish(value)` | Publish a value to consumers without completing. |

### useWorkflow Hook

```ts
const {
  state,      // WorkflowState<T> — tagged union (see below)
  published,  // unknown — published value from the workflow
  signal,     // (name, payload) => void — send data into the workflow
  cancel,     // () => void — cancel with AbortSignal propagation
  reset,      // () => void — clear event log and restart
} = useWorkflow(id, workflowFn, { storage, version?, onEvent?, snapshot? });
```

`WorkflowState<T>` is a discriminated union:

```ts
| { status: "running" }
| { status: "waiting" }
| { status: "completed"; result: T }
| { status: "failed"; error: string }
| { status: "cancelled" }
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
const checkoutWorkflow = workflow(function* () {
  const profile = yield* join("profile");
  // ...
});
```

Circular dependencies are detected and throw immediately with a descriptive error.

### Resilience

Wrap any activity function with automatic retry and backoff:

```ts
import { withRetry } from "cursus";

const result = yield* activity(
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

const result = yield* activity(
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

const result = yield* activity("fetchData", resilient(fetchData));
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

- [Getting Started](./docs/getting-started.md)
- [Workflows](./docs/workflows.md) — commands and composition
- [Layers](./docs/layers.md) — shared workflows and cross-workflow dependencies
- [Storage](./docs/storage.md) — persistence and versioning
- [Testing](./docs/testing.md) — `createTestRuntime`
- [Resilience](./docs/resilience.md) — retry and circuit breaker
- [Observability](./docs/observability.md) — event observers and debug panel
- [SSR & Hydration](./docs/ssr.md) — server-side execution and snapshot hydration
- [API Reference](./docs/api-reference.md) — exhaustive type and export reference

## Examples

The `examples/` directory contains runnable Vite apps:

| Example | Demonstrates |
|---------|-------------|
| `login` | Credential validation with retry loop |
| `sso-login` | OAuth-style token exchange |
| `wizard` | Sequential multi-step form |
| `job-application` | Nested child workflows |
| `checkout` | Cross-workflow dependencies with `all` |
| `shop` | Multi-workflow layer with error simulation |
| `chat-room` | Long-running `handle` loop |
| `cookie-banner` | Result derived from event history |
| `env-config` | Workflow as environment provider |
| `error-recovery` | `withRetry` and dependency failure handling |
| `race` | Fetch-with-timeout via `race` |
| `ssr` | Server-side execution with snapshot hydration |
| `opentelemetry` | Event observer integration |
| `publish` | Intermediate state via `publish` |
| `subscribe` | Cross-workflow `published` consumption |

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

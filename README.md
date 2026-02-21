# react-workflow

Durable workflows for React, inspired by [Temporal](https://temporal.io). Write multi-step UI flows as generator functions. State survives page reloads via event-sourcing replay — no manual serialization needed.

```
npm install react-workflow
```

## Quick Example

Define a workflow as a generator function:

```ts
import type { WorkflowFunction } from "react-workflow";

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
import { useWorkflow, LocalStorage } from "react-workflow";

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

## API Overview

### Workflow Context

Commands available inside a workflow generator via `ctx`:

| Command | Description |
|---------|-------------|
| `activity(name, fn)` | Execute a side effect (API call, computation). Result is recorded. |
| `waitFor(signal)` | Pause until a named signal arrives from the UI. |
| `waitForAny(...signals)` | Pause until any of several signals arrives. |
| `waitAll(...items)` | Wait for multiple signals and/or workflow results in parallel. |
| `sleep(ms)` | Durable timer — survives page reload. |
| `child(name, fn)` | Run a nested sub-workflow with its own event log. |
| `waitForWorkflow(id)` | Block until another registered workflow completes. |
| `race(...branches)` | Race concurrent branches, cancel the losers. |
| `on(handlers)` / `done(value)` | Event-loop style signal handling. |
| `query(name, handler)` | Expose live workflow state for external reads. |

### useWorkflow Hook

```ts
const {
  state,        // "running" | "waiting" | "completed" | "failed" | "cancelled"
  result,       // T | undefined
  error,        // string | undefined
  waitingFor,   // current signal name, if waiting
  signal,       // (name, payload) => void — send data into the workflow
  query,        // (name) => value — read live query state
  cancel,       // () => void — cancel with AbortSignal propagation
  reset,        // () => void — clear event log and restart
} = useWorkflow(id, workflowFn, { storage });
```

### Cross-Workflow Dependencies

Register multiple workflows and let them depend on each other:

```tsx
import { createLayer, WorkflowLayerProvider, useWorkflow } from "react-workflow";

const layer = createLayer(
  { profile: profileWorkflow, checkout: checkoutWorkflow },
  new LocalStorage(),
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

### Retry

Wrap any activity function with automatic retry and backoff:

```ts
import { withRetry } from "react-workflow";

const result = yield* ctx.activity(
  "fetchData",
  withRetry(async (signal) => fetch("/api/data", { signal }), {
    maxAttempts: 3,
    backoff: "exponential",
    initialDelayMs: 1000,
  }),
);
```

### Testing

Test workflows without React, storage, or real async:

```ts
import { createTestRuntime } from "react-workflow";

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

## Examples

The `examples/` directory contains runnable Vite apps:

- **login** — credential validation with retry loop
- **sso-login** — OAuth-style token exchange
- **wizard** — sequential multi-step form
- **job-application** — nested child workflows
- **checkout** — cross-workflow dependencies
- **shop** — real HTTP with error simulation
- **chat-room** — long-running workflow with repeated signals
- **cookie-banner** — result derived from event history
- **error-recovery** — dependency failure handling
- **race** — fetch-with-timeout pattern

```
cd examples/login
npm install
npm run dev
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design — event sourcing model, replay mechanics, and deviations from Temporal.

## License

[MIT](./LICENSE)

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
import { workflow, receive, activity } from "cursus";

const loginWorkflow = workflow(function* () {
  // Pause until the user submits credentials
  const creds = yield* receive<{ username: string; password: string }>("credentials");

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

Register it and use it in a component:

```tsx
import { createRegistry, LocalStorage } from "cursus";
import { createBindings } from "cursus/react";

const registry = createRegistry(new LocalStorage())
  .add("login", loginWorkflow)
  .build();

const { useWorkflow, Provider } = createBindings(registry);

function App() {
  return <Provider><LoginPage /></Provider>;
}

function LoginPage() {
  const { state, signal, reset } = useWorkflow("login");

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
- **Receive & ask** — `receive` for UI-to-workflow signals, `ask` for cross-workflow reads
- **Activities** — async side effects with automatic replay skipping
- **Timers** — durable `sleep` that survives reloads
- **all & race** — concurrent branches with `all()` and first-to-complete `race()`
- **Child workflows** — compose via `yield*` delegation
- **Cross-workflow dependencies** — `ask()` with circular dependency detection
- **Signal loops** — `handler()` for long-running interactive workflows
- **Publish** — expose intermediate workflow state to consumers (non-serializable values OK)
- **Registries** — share workflows across the component tree via React context
- **Versioning** — version-stamp workflows to detect and wipe stale event logs
- **Resilience** — try/catch + loop for retry patterns
- **Testing** — `createTestRuntime` with mock activities and pre-queued signals
- **SSR** — server-side registry execution, event-seeding hydration
- **Observability** — `WorkflowEventObserver`, `useWorkflowEvents`, built-in `WorkflowDebugPanel`
- **Type-safe** — signal and activity types inferred from workflow definition; non-serializable payloads rejected at compile time

## API Overview

### Workflow Commands

Free functions yielded inside a workflow generator:

| Command | Description |
|---------|-------------|
| `activity(name, fn)` | Execute a side effect (API call, computation). Result is recorded. Return type must be serializable. |
| `receive(label)` | Pause until an external `signal(label, payload)` delivers a value. Payload must be serializable. |
| `ask(id)` | Read the current output of another registered workflow. Value is recomputed live on replay — non-serializable values (services, class instances) are safe. |
| `sleep(ms)` | Durable timer — survives page reload. |
| `all(...branches)` | Wait for multiple branches concurrently, return all results. |
| `race(...branches)` | Race concurrent branches, cancel the losers. |
| `child(name, wf)` | Run a nested sub-workflow with its own event log. |
| `handler().on(...).as()` | Builder for multi-signal loop with `done()` to exit. |
| `publish(value)` | Publish a value to consumers without completing. Value is never serialized to the log. |

### useWorkflow Hook

```ts
const {
  state,      // WorkflowState<T> — tagged union (see below)
  published,  // unknown — published value from the workflow
  signal,     // (name, payload) => void — send data into the workflow
  cancel,     // () => void — cancel with AbortSignal propagation
  reset,      // () => void — clear event log and restart
} = useWorkflow(id); // requires a registry Provider ancestor
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
import { createRegistry, LocalStorage } from "cursus";
import { createBindings } from "cursus/react";

const registry = createRegistry(new LocalStorage())
  .add("profile", profileWorkflow)
  .add("checkout", checkoutWorkflow)
  .build();

const { useWorkflow, Provider } = createBindings(registry);

function App() {
  return (
    <Provider>
      <ProfilePage />
      <CheckoutPage />
    </Provider>
  );
}

// Inside checkoutWorkflow:
const checkoutWorkflow = workflow(function* () {
  const profile = yield* ask("profile").as<Profile>();
  // ...
});
```

Circular dependencies are detected and throw immediately with a descriptive error.

### Resilience

Use `loop` + `try/catch` + `sleep` for retry patterns:

```ts
import { workflow, activity, loop, loopBreak, sleep } from "cursus";

const resilientWorkflow = workflow(function* () {
  const result = yield* loop(function* () {
    try {
      const data = yield* activity("fetchData", async (signal) =>
        fetch("/api/data", { signal }).then((r) => r.json()),
      );
      yield* loopBreak(data);
    } catch {
      yield* sleep(1000); // backoff before retry
    }
  });
  return result;
});
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
| Custom `WorkflowStorage` | Implement `load`, `append`, `clear` for any backend |

## Tutorials

- [Todo App](./docs/tutorials/todo-app.md) — build a durable todo app with `handler`, `publish`, and `useWorkflow`
- [E-Commerce Multi-Workflow](./docs/tutorials/multi-workflow.md) — registries, cross-workflow dependencies, `merge`, and `usePublished`

## Documentation

- [Getting Started](./docs/getting-started.md)
- [Workflows](./docs/workflows.md) — commands and composition
- [Registries](./docs/registries.md) — shared workflows and cross-workflow dependencies
- [Storage](./docs/storage.md) — persistence and versioning
- [Testing](./docs/testing.md) — `createTestRuntime`
- [Resilience](./docs/resilience.md) — retry patterns with loop and try/catch
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
| `shop` | Multi-workflow registry with error simulation |
| `chat-room` | Long-running `handler` loop |
| `cookie-banner` | Result derived from event history |
| `env-config` | Workflow as environment provider |
| `error-recovery` | Retry with loop/try/catch and dependency failure handling |
| `race` | Fetch-with-timeout via `race` |
| `ssr` | Server-side execution with snapshot hydration |
| `opentelemetry` | Event observer integration |
| `publish` | Intermediate state via `publish` |
| `merge` | Type-safe registry merging |
| `user-list` | Multi-signal handler loop with `handler()` |

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

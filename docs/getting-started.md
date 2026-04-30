---
sidebar_position: 1
slug: /
---

# Getting Started

cursus brings durable workflows to React. Workflows are generator functions that yield commands — activities, signals, timers — and the library handles persistence, replay, and coordination automatically.

If a user refreshes mid-workflow, the engine replays the event log and resumes exactly where it left off, without re-running completed activities.

## Installation

```bash
npm install cursus
```

Optional peer dependencies: `react >= 18.0.0`, `react-dom >= 18.0.0` (required for `cursus/react` and `cursus/devtools`)

## Your First Workflow

A workflow is a generator function wrapped with `workflow()`:

```ts
import { workflow, receive, activity } from "cursus";

const greetingWorkflow = workflow(function* () {
  const name = yield* receive<string>("name");
  const greeting = yield* activity("greet", async () => {
    return `Hello, ${name}!`;
  });
  return greeting;
});
```

This workflow:

1. Waits for a `"name"` signal from the UI via `receive()`
2. Runs a `"greet"` activity
3. Returns the result

Every `yield*` is a checkpoint. If the page reloads after step 1, the engine replays the stored signal and skips straight to step 2.

**Two primitives pull external values into a workflow:**

- `receive(label)` — wait for an external `signal()` call. The payload is recorded in the event log and replayed verbatim, so it must be JSON-serializable.
- `ask(label)` — read the current output of another workflow registered under `label`. The value is re-hydrated live on every replay, so non-serializable values (functions, class instances, service bundles) are safe.

## Using it in React

The registry is the runtime. Create one, register your workflows, wrap your app in the `Provider`, then consume workflows with `useWorkflow`:

```tsx
import { createRegistry, LocalStorage } from "cursus";
import { createBindings } from "cursus/react";

const registry = createRegistry(new LocalStorage("my-app"))
  .add("greeter", greetingWorkflow)
  .build();

const { useWorkflow, Provider } = createBindings(registry);

function App() {
  return (
    <Provider>
      <Greeter />
    </Provider>
  );
}

function Greeter() {
  const { state, signal } = useWorkflow("greeter");

  if (state.status === "waiting") {
    return (
      <form onSubmit={(e) => {
        e.preventDefault();
        const name = new FormData(e.currentTarget).get("name") as string;
        signal("name", name);
      }}>
        <input name="name" placeholder="Your name" />
        <button type="submit">Go</button>
      </form>
    );
  }

  if (state.status === "completed") {
    return <p>{state.result}</p>;
  }

  return <p>Working...</p>;
}
```

## useWorkflow Return Value

| Field | Type | Description |
|-------|------|-------------|
| `state` | `WorkflowState<T>` | Tagged union: `{ status: "running" }` \| `{ status: "waiting" }` \| `{ status: "completed", result: T }` \| `{ status: "failed", error: string }` \| `{ status: "cancelled" }` |
| `published` | `T \| undefined` | The workflow's published value, if any |
| `signal(name, payload)` | function | Send a signal into the workflow |
| `cancel()` | function | Cancel the running workflow |
| `reset()` | function | Clear storage and restart from scratch |

## Persistence

The registry's storage is set when you call `createRegistry(storage)`. Pass `LocalStorage` to survive page reloads:

```ts
import { LocalStorage } from "cursus";

const registry = createRegistry(new LocalStorage("my-app"))
  .add("greeter", greetingWorkflow)
  .build();
```

Events are persisted incrementally. When a workflow completes, its full event log stays in storage so replay on remount can produce the same result without re-running side-effectful activities.

## What's Next

- [Workflows](./workflows.md) — the full workflow API
- [Registries](./registries.md) — shared workflows across your component tree
- [Storage](./storage.md) — persistence options and versioning
- [Testing](./testing.md) — test workflows without React

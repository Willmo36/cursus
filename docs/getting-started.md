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

A workflow is a generator function that receives a context object:

```ts
import type { WorkflowFunction } from "cursus";

const greetingWorkflow: WorkflowFunction<string> = function* (ctx) {
  const name = yield* ctx.waitFor<string>("name");
  const greeting = yield* ctx.activity("greet", async () => {
    return `Hello, ${name}!`;
  });
  return greeting;
};
```

This workflow:

1. Waits for a `"name"` signal from the UI
2. Runs a `"greet"` activity
3. Returns the result

Every `yield*` is a checkpoint. If the page reloads after step 1, the engine replays the stored signal and skips straight to step 2.

## Using it in React

The `useWorkflow` hook runs a workflow and gives you reactive state:

```tsx
import { MemoryStorage } from "cursus";
import { useWorkflow } from "cursus/react";

function Greeter() {
  const { state, result, waitingFor, signal } = useWorkflow(
    "greeter",
    greetingWorkflow,
    { storage: new MemoryStorage() },
  );

  if (waitingFor === "name") {
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

  if (state === "completed") {
    return <p>{result}</p>;
  }

  return <p>Working...</p>;
}
```

## useWorkflow Return Value

| Field | Type | Description |
|-------|------|-------------|
| `state` | `WorkflowState` | `"running"` \| `"waiting"` \| `"completed"` \| `"failed"` \| `"cancelled"` |
| `result` | `T \| undefined` | The workflow's return value, once completed |
| `error` | `string \| undefined` | Error message if the workflow failed |
| `waitingFor` | `string \| undefined` | The signal name the workflow is blocked on |
| `waitingForAll` | `string[] \| undefined` | Signal names when using `waitForAll` |
| `waitingForAny` | `string[] \| undefined` | Signal names when using `waitForAny` |
| `signal(name, payload)` | function | Send a signal into the workflow |
| `query(name)` | function | Read a query value exposed by the workflow |
| `cancel()` | function | Cancel the running workflow |
| `reset()` | function | Clear storage and restart from scratch |

## Persistence

By default, inline workflows use an ephemeral `MemoryStorage`. To survive page reloads, pass `LocalStorage`:

```tsx
import { LocalStorage } from "cursus";

const { state, result } = useWorkflow("greeter", greetingWorkflow, {
  storage: new LocalStorage("my-app"),
});
```

Events are persisted incrementally. When the workflow completes, storage is compacted to just the terminal event.

## What's Next

- [Workflows](./workflows.md) — the full `WorkflowContext` API
- [Layers](./layers.md) — shared workflows across your component tree
- [Storage](./storage.md) — persistence options and versioning
- [Testing](./testing.md) — test workflows without React

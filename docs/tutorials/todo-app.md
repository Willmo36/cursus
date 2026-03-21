---
sidebar_position: 1
---

# Tutorial: Todo App

Build a todo app where the entire application state lives inside a durable workflow. Adding, removing, and completing items are signals sent into the workflow — and state survives a full page reload without any manual serialization.

By the end you'll understand:

- `workflow`, `query`, `activity`, `publish`, `handler`
- `useWorkflow` for React integration
- How event-sourcing replay makes state durable

## Prerequisites

- React and TypeScript basics
- A Vite + React project (or equivalent)

```bash
npm install cursus
```

## Step 1: Define the Data

```ts
// src/workflows.ts
import { workflow, query, publish, handler, activity } from "cursus";

type Todo = {
  id: string;
  text: string;
  done: boolean;
};
```

## Step 2: Build the Workflow

The todo workflow waits for the user to add the first item, then enters a signal loop that handles add, toggle, and remove operations until the user clears the list.

```ts
// src/workflows.ts (continued)

export const todoWorkflow = workflow(function* () {
  let todos: Todo[] = [];

  // Wait for the first item
  const firstText = yield* query("add").as<string>();
  todos = [{ id: crypto.randomUUID(), text: firstText, done: false }];
  yield* publish(todos);

  // Enter the signal loop
  const finalTodos = yield* handler()
    .on("add", function* (text: string) {
      todos = [...todos, { id: crypto.randomUUID(), text, done: false }];
      yield* publish(todos);
    })
    .on("toggle", function* (id: string) {
      todos = todos.map((t) =>
        t.id === id ? { ...t, done: !t.done } : t,
      );
      yield* publish(todos);
    })
    .on("remove", function* (id: string) {
      todos = todos.filter((t) => t.id !== id);
      yield* publish(todos);
    })
    .on("clear", function* (_payload: undefined, done) {
      yield* done(todos);
    })
    .as<Todo[]>();

  return finalTodos;
});
```

Let's walk through what's happening:

1. **`query("add").as<string>()`** — pauses the workflow until the UI sends an `"add"` signal. The workflow is in `"waiting"` status.
2. **`publish(todos)`** — pushes the current list to the UI without ending the workflow. Components see it via `useWorkflow`'s `published` field.
3. **`handler().on(...).as<Todo[]>()`** — enters a loop that waits for one of four signals. Each `.on()` branch is a generator that can call `publish` to update consumers. The loop continues until a branch calls `done(value)`, which becomes the return value of the handler.

Every `yield*` is a checkpoint. If the user reloads mid-workflow, the engine replays all recorded signals and activities to reconstruct `todos` exactly.

## Step 3: Wire It Up in React

```tsx
// src/App.tsx
import { useState } from "react";
import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";
import { todoWorkflow } from "./workflows";

const storage = new LocalStorage("todo-app");

type Todo = {
  id: string;
  text: string;
  done: boolean;
};

export function App() {
  const { state, signal, published, reset } = useWorkflow(
    "todos",
    todoWorkflow,
    { storage },
  );

  const todos = (published as Todo[] | undefined) ?? [];
  const [draft, setDraft] = useState("");

  const addTodo = () => {
    if (!draft.trim()) return;
    signal("add", draft.trim());
    setDraft("");
  };

  if (state.status === "completed") {
    return (
      <div>
        <p>List cleared — {state.result.length} items archived.</p>
        <button onClick={reset}>Start Over</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Todos</h1>

      <form onSubmit={(e) => { e.preventDefault(); addTodo(); }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What needs doing?"
        />
        <button type="submit">Add</button>
      </form>

      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => signal("toggle", todo.id)}
              />
              <span style={{ textDecoration: todo.done ? "line-through" : "none" }}>
                {todo.text}
              </span>
            </label>
            <button onClick={() => signal("remove", todo.id)}>×</button>
          </li>
        ))}
      </ul>

      {todos.length > 0 && (
        <button onClick={() => signal("clear", undefined)}>
          Clear All
        </button>
      )}
    </div>
  );
}
```

Key points:

- **`published`** contains the latest todo list. It starts as `undefined` and updates each time the workflow calls `publish`.
- **`signal("add", text)`** sends data into the workflow. The `handler` loop picks it up, updates the list, and publishes.
- **`state.status`** drives the top-level UI. The workflow is `"waiting"` when it needs input, `"completed"` after `done()` is called.
- **`reset`** clears the event log and restarts the workflow from scratch.

## Step 4: Try It

```bash
npm run dev
```

1. Add a few todos
2. Toggle some as done
3. **Refresh the page** — your todos are still there
4. Click "Clear All" — the workflow completes and shows the archived count
5. Click "Start Over" — `reset` wipes the log and you're back to an empty list

## Step 5: Add Persistence with Activities

Right now `publish` broadcasts state to the UI, but what if you want to also save to a server? Wrap the server call in an `activity` so it only runs once — replays skip it:

```ts
.on("add", function* (text: string) {
  const newTodo = { id: crypto.randomUUID(), text, done: false };
  todos = [...todos, newTodo];

  // This API call runs once. On replay, the stored result is used.
  yield* activity("save-todo", async () => {
    await fetch("/api/todos", {
      method: "POST",
      body: JSON.stringify(newTodo),
    });
  });

  yield* publish(todos);
})
```

Activities are the boundary between deterministic workflow logic and the outside world. Anything with side effects — API calls, file writes, random number generation — should be an activity.

## What's Next

- [Multi-Workflow Tutorial](./multi-workflow.md) — registries, cross-workflow dependencies, and `usePublished`
- [Testing](../testing.md) — test this workflow without React using `createTestRuntime`
- [API Reference](../api-reference.md) — full reference for all commands and hooks

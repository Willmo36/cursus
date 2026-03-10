---
sidebar_position: 5
---

# Testing

`createTestRuntime` runs a workflow outside of React with mock activities and pre-queued signals. It uses the real interpreter, so your tests exercise actual workflow logic — not mocked behavior.

## Basic Usage

```ts
import { createTestRuntime } from "cursus";

const result = await createTestRuntime(myWorkflow, {
  activities: {
    "fetch-user": () => ({ name: "Max" }),
  },
  signals: [
    { name: "confirm", payload: "yes" },
  ],
});

expect(result).toBe("expected value");
```

## Options

| Option | Type | Description |
|--------|------|-------------|
| `activities` | `Record<string, (...args) => unknown>` | Mock functions keyed by activity name. Unmocked activities run their real implementation. |
| `signals` | `Array<{ name, payload }>` | Pre-queued signals, delivered automatically when the workflow waits for them. |
| `workflowResults` | `Record<string, unknown>` | Mock results for `join` / `published` dependencies. |

## Mock Activities

Provide mock implementations by activity name. Activities not in the map fall through to the real function:

```ts
const result = await createTestRuntime(workflow, {
  activities: {
    "fetch-user": () => ({ name: "Test User" }),
    // "save-user" not mocked — runs the real async function
  },
});
```

## Pre-queued Signals

Signals are automatically delivered when the workflow enters a waiting state. They're matched by name and consumed in order:

```ts
// Sequential waitFor calls
const workflow: WorkflowFunction<string> = function* (ctx) {
  const email = yield* ctx.waitFor<string>("email");
  const password = yield* ctx.waitFor<string>("password");
  return `${email}:${password}`;
};

const result = await createTestRuntime(workflow, {
  signals: [
    { name: "email", payload: "test@example.com" },
    { name: "password", payload: "secret" },
  ],
});
```

Signals also work with `all`, `race`, and `on`/`done` loops:

```ts
// all — waits for all signals
const result = await createTestRuntime(allWorkflow, {
  signals: [
    { name: "email", payload: "a@b.com" },
    { name: "password", payload: "secret" },
  ],
});

// race — first matching signal is delivered
const result = await createTestRuntime(raceWorkflow, {
  signals: [{ name: "reject", payload: "no" }],
});

// on/done loop
const result = await createTestRuntime(counterWorkflow, {
  signals: [
    { name: "inc", payload: undefined },
    { name: "inc", payload: undefined },
    { name: "finish", payload: undefined },
  ],
});
```

## Cross-Workflow Dependencies

Mock `join` / `published` results with `workflowResults`:

```ts
const workflow: WorkflowFunction<string, {}, { login: string }> = function* (ctx) {
  const user = yield* ctx.join("login");
  return `got: ${user}`;
};

const result = await createTestRuntime(workflow, {
  workflowResults: { login: "test-user" },
});
```

All three options compose freely:

```ts
const result = await createTestRuntime(workflow, {
  activities: { greet: () => "mock-hello" },
  signals: [{ name: "confirm", payload: "yes" }],
  workflowResults: { login: "mock-user" },
});
```

## Child Workflows

Activity mocks propagate into child workflows automatically:

```ts
const child: WorkflowFunction<string> = function* (ctx) {
  return yield* ctx.activity("fetch", async () => "real");
};

const parent: WorkflowFunction<string> = function* (ctx) {
  return yield* ctx.child("sub", child);
};

const result = await createTestRuntime(parent, {
  activities: { fetch: () => "mocked" },
});
// result === "mocked"
```

This works through any depth of nesting.

## Error Handling

If a workflow fails (uncaught activity error), `createTestRuntime` throws:

```ts
await expect(
  createTestRuntime(failingWorkflow, {}),
).rejects.toThrow("boom");
```

Workflows that catch errors internally work as expected:

```ts
const workflow: WorkflowFunction<string> = function* (ctx) {
  try {
    yield* ctx.activity("risky", async () => { throw new Error("boom"); });
  } catch {
    return yield* ctx.activity("recover", async () => "safe");
  }
};

const result = await createTestRuntime(workflow, {
  activities: { recover: () => "mock-safe" },
});
// result === "mock-safe"
```

## Type Safety

Signal payloads are type-checked against your `SignalMap`:

```ts
const workflow: WorkflowFunction<string, { email: string; count: number }> = // ...

await createTestRuntime(workflow, {
  signals: [
    { name: "email", payload: "test@example.com" },  // OK
    { name: "count", payload: 42 },                   // OK
    // { name: "email", payload: 42 },                // Type error
  ],
});
```

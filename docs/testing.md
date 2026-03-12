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
const result = await createTestRuntime(myWorkflow, {
  activities: {
    "fetch-user": () => ({ name: "Test User" }),
    // "save-user" not mocked — runs the real async function
  },
});
```

## Pre-queued Signals

Signals are automatically delivered when the workflow enters a waiting state. They're matched by name and consumed in order:

```ts
// Sequential receive calls
const myWorkflow = workflow(function* () {
  const email = yield* receive<string>("email");
  const password = yield* receive<string>("password");
  return `${email}:${password}`;
});

const result = await createTestRuntime(myWorkflow, {
  signals: [
    { name: "email", payload: "test@example.com" },
    { name: "password", payload: "secret" },
  ],
});
```

Signals also work with `all`, `race`, and `handle` loops:

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

// handle loop
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
const myWorkflow = workflow(function* () {
  const user = yield* join("login");
  return `got: ${user}`;
});

const result = await createTestRuntime(myWorkflow, {
  workflowResults: { login: "test-user" },
});
```

All three options compose freely:

```ts
const result = await createTestRuntime(myWorkflow, {
  activities: { greet: () => "mock-hello" },
  signals: [{ name: "confirm", payload: "yes" }],
  workflowResults: { login: "mock-user" },
});
```

## Child Workflows

Activity mocks propagate into child workflows automatically:

```ts
const childWorkflow = workflow(function* () {
  return yield* activity("fetch", async () => "real");
});

const parentWorkflow = workflow(function* () {
  return yield* child("sub", childWorkflow);
});

const result = await createTestRuntime(parentWorkflow, {
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
const myWorkflow = workflow(function* () {
  try {
    yield* activity("risky", async () => { throw new Error("boom"); });
  } catch {
    return yield* activity("recover", async () => "safe");
  }
});

const result = await createTestRuntime(myWorkflow, {
  activities: { recover: () => "mock-safe" },
});
// result === "mock-safe"
```

## Type Safety

Signal payloads are type-checked against the signals used by your workflow:

```ts
const myWorkflow = workflow(function* () {
  const email = yield* receive<string>("email");
  const count = yield* receive<number>("count");
  return `${email}:${count}`;
});

await createTestRuntime(myWorkflow, {
  signals: [
    { name: "email", payload: "test@example.com" },  // OK
    { name: "count", payload: 42 },                   // OK
    // { name: "email", payload: 42 },                // Type error
  ],
});
```

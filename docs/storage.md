---
sidebar_position: 4
---

# Storage

Workflows persist their event logs to storage. On reload, the engine replays events through the generator to restore state without re-running activities.

## Built-in Implementations

### MemoryStorage

In-memory storage that doesn't survive page reloads. Useful for tests and ephemeral workflows:

```ts
import { MemoryStorage } from "cursus";

const storage = new MemoryStorage();
```

This is the default when no storage is provided to `createRegistry`.

### LocalStorage

Persists to `window.localStorage`. Survives page reloads:

```ts
import { LocalStorage } from "cursus";

const storage = new LocalStorage("my-app");
```

The prefix scopes keys to avoid collisions. Events are stored as JSON at `${prefix}:${workflowId}`, version stamps at `${prefix}:${workflowId}:v`.

## Custom Storage

Implement the `WorkflowStorage` interface to use any backend:

```ts
import type { WorkflowStorage, WorkflowEvent } from "cursus";

const myStorage: WorkflowStorage = {
  async load(workflowId: string): Promise<WorkflowEvent[]> {
    // Return stored events, or [] if none
  },
  async append(workflowId: string, events: WorkflowEvent[]): Promise<void> {
    // Append events to the existing log
  },
  async clear(workflowId: string): Promise<void> {
    // Delete all stored data for this workflow
  },

  // Optional — needed for versioning support:
  async loadVersion(workflowId: string): Promise<number | undefined> {
    // Return stored version, or undefined if none
  },
  async saveVersion(workflowId: string, version: number): Promise<void> {
    // Persist the version number
  },
};
```

The `loadVersion` and `saveVersion` methods are optional. Custom implementations without them simply skip version checks.

## Event Log Lifetime

The full event log is retained for the lifetime of a workflow, including after it completes or fails. Replay on reload re-runs the generator against the stored events — activities and receives fast-forward from their logged results, so no side effects re-fire. Storage size grows linearly with workflow length; long-running workflows with many steps should factor this in.

Only two event types carry payload data: `activity_completed` (result) and `receive_resolved` (value). Everything else is a marker that records *that* something happened, not what the value was. Values produced by `publish`, `return`, `loopBreak`, or branches inside `all`/`race` are recomputed in memory on replay, so non-serializable values are safe in those positions.

## Versioning

When a workflow's code structure changes (adding/removing/reordering `yield*` steps), persisted event logs become incompatible. Instead of crashing with replay errors, you can version workflows so stale logs are detected and wiped cleanly.

### Workflow Versions

Pass a version number to `createRegistry` options (this is done via the `versions` option on `WorkflowRegistry` directly, or through `checkVersion` before starting):

```ts
import { checkVersion } from "cursus";

// Called before registry.start(id) — wipes storage if version mismatches
const wiped = await checkVersion(storage, "checkout", 2);
// wiped: true if storage was cleared due to version mismatch
```

It's a no-op when `version` is `undefined` or when storage lacks version methods.

### Dependency Graph Version Busting

When a workflow uses `ask()` to depend on another workflow, the version of that dependency is recorded in the event log at resolution time. On replay, if the dependency's version has changed, the consumer's event log is automatically wiped and the workflow restarts fresh — even if the consumer's own version didn't change.

This means bumping a dependency's version cascades to all consumers:

```ts
// dep was at version 1 — checkout's stored log references dep@v1
// bump dep to version 2:
const registry = new WorkflowRegistry(
  { dep: depWorkflow, checkout: checkoutWorkflow },
  storage,
  { versions: { dep: 2 } },
);
// On start: checkout's log is detected as stale (dep@v1 ≠ dep@v2) and wiped
await registry.start("checkout"); // runs fresh
```

No explicit consumer version bump is needed — the registry detects the mismatch automatically at the `ask()` replay point.

### When to Bump the Version

Bump when your workflow's **structure** changes:

- Added or removed a `yield*` step
- Reordered steps
- Changed the type of a command at a given position

Don't bump for:

- Changes inside activity functions (the activity body isn't part of the event log)
- Changes to non-yielding code between steps

### checkVersion

```ts
import { checkVersion } from "cursus";

const wiped = await checkVersion(storage, "checkout", 2);
// wiped: true if storage was cleared due to version mismatch
```

## Storage Pressure

Long-running workflows (especially `handler()` loops) can accumulate large event logs over time. Use the `onStoragePressure` hook to detect this and respond — log to Sentry, alert the team, or prompt the user to restart:

```ts
const registry = createRegistry(new LocalStorage("my-app"))
  .add("chat", chatWorkflow)
  .build({
    onStoragePressure: (workflowId, eventCount, byteEstimate) => {
      Sentry.captureMessage("Workflow log growing large", {
        extra: { workflowId, eventCount, byteEstimate },
      });
    },
    storagePressureThreshold: 500, // default: 500 events
  });
```

The hook fires after each persist when the total event count meets or exceeds the threshold. No events are evicted — the hook is informational only. The `byteEstimate` is a rough `JSON.stringify` size of the full event array.

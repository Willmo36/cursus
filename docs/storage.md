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

### How It Works

1. On start, the engine compares the stored version to the current version
2. If they match (or no version is set), proceed normally
3. If they differ, clear storage and restart fresh
4. If no version was stored yet (first run), save the version and proceed

No migration logic — just wipe and restart.

### Registry Mode

Versioning is configured per-workflow via `checkVersion` before building:

```ts
const registry = createRegistry(storage)
  .add("checkout", checkoutWorkflow)
  .add("profile", profileWorkflow)
  .build();

// Check version before starting
await checkVersion(storage, "checkout", 2);
```

Only versioned workflows get the check. In this example, `profile` has no version and skips the check entirely.

### When to Bump the Version

Bump when your workflow's **structure** changes:

- Added or removed a `yield*` step
- Reordered steps
- Changed the type of a command at a given position

Don't bump for:

- Changes inside activity functions (the activity body isn't part of the event log)
- Changes to non-yielding code between steps

### checkVersion

The `checkVersion` helper is exported for advanced use cases:

```ts
import { checkVersion } from "cursus";

const wiped = await checkVersion(storage, "checkout", 2);
// wiped: true if storage was cleared due to version mismatch
```

It's a no-op when `version` is `undefined` or when storage lacks version methods.

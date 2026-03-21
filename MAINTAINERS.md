# cursus Maintainer's Guide

A durable workflow engine for React. Workflows are generator functions that yield commands; an interpreter executes them, records every step in an append-only event log, and replays from that log on reload.

---

## Architecture Overview

```mermaid
graph TB
    subgraph "React Bindings"
        UW["useWorkflow()"]
        UWE["useWorkflowEvents()"]
        PROV["Provider (createBindings)"]
        DP["WorkflowDebugPanel"]
    end

    subgraph "Core Engine"
        INT[Interpreter]
        EL[EventLog]
        REG[WorkflowRegistry]
    end

    subgraph "Persistence"
        MS[MemoryStorage]
        LS[LocalStorage]
    end

    PROV -->|creates| REG
    UW -->|registry mode| REG
    UW -->|inline mode| INT
    UW -->|observe/unobserve| REG
    INT -->|appends events| EL
    INT -->|cross-workflow deps| REG
    REG -->|manages| INT
    REG -->|persists via| MS
    REG -->|persists via| LS
    UWE -->|reads from| REG
    DP -->|uses| UWE
```

---

## The Generator Protocol

Workflows are generator functions. They `yield` **commands** to the interpreter and receive **results** back. The interpreter decides _how_ to execute each command (run it live, or replay it from the log).

```mermaid
sequenceDiagram
    participant WF as Workflow Generator
    participant INT as Interpreter
    participant LOG as EventLog
    participant EXT as External (API, Timer, Signal)

    INT->>WF: gen.next()
    WF-->>INT: yield ActivityCommand
    INT->>LOG: append(activity_scheduled)
    INT->>EXT: await fn()
    EXT-->>INT: result
    INT->>LOG: append(activity_completed)
    INT->>WF: gen.next(result)
    WF-->>INT: yield QueryCommand
    INT->>LOG: (waiting...)
    Note over INT: state = "waiting"
    EXT->>INT: signal("submit", data)
    INT->>LOG: append(query_resolved)
    INT->>WF: gen.next(data)
    WF-->>INT: return finalResult
    INT->>LOG: append(workflow_completed)
```

### Command Types

| Command | What it does | Free function |
|---------|-------------|---------------|
| `ActivityCommand` | Run an async function | `activity(name, fn)` |
| `QueryCommand` | Block until a named query is resolved (signal or workflow dep) | `query(label)` |
| `AllCommand` | Wait for multiple branches concurrently | `all(...)` |
| `RaceCommand` | Race branches, first to complete wins | `race(...)` |
| `SleepCommand` | Block for a duration | `sleep(ms)` |
| `ChildCommand` | Run a child workflow with its own event log | `child(name, wf)` |
| `PublishCommand` | Publish a value to consumers | `publish(value)` |
| `LoopCommand` | Repeat a body until break | `loop(body)` |
| `LoopBreakCommand` | Exit a loop with a value | `loopBreak(value)` |

---

## Event Sourcing and Replay

Every command execution records events in an append-only log. On reload, the interpreter replays the generator through recorded events without re-executing side effects.

```mermaid
flowchart TD
    START[interpreter.run] --> CHECK_REPLAY{Event in log<br/>for this seq?}
    CHECK_REPLAY -->|Yes| RETURN_STORED[Return stored result<br/>skip execution]
    CHECK_REPLAY -->|No| EXECUTE[Execute live]
    EXECUTE --> RECORD[Append event to log]
    RECORD --> PERSIST[Persist to storage]
    RETURN_STORED --> NEXT[gen.next result]
    PERSIST --> NEXT
    NEXT --> DONE{Generator done?}
    DONE -->|No| CHECK_REPLAY
    DONE -->|Yes| COMPLETE[workflow_completed]
```

### How replay works

Each command gets a monotonically increasing **sequence number** (`seq`). Before executing any async command, the interpreter checks the event log:

```
seq=1: activity "fetch-user" → log has activity_completed(seq=1) → return stored result
seq=2: query "confirm"      → log has query_resolved(seq=2)     → return stored value
seq=3: activity "send-email" → no matching event                → execute live
```

The generator is deterministic (same inputs produce same yields), so replaying old results through it fast-forwards to the exact point where new work begins.

### Non-determinism detection

If an activity's name changes between the original run and replay (e.g., code was refactored while events are persisted), the interpreter throws:

```
Non-determinism detected: activity at seq 2 was "fetch-user" but is now "get-profile"
```

### Event Types

| Event | Recorded when |
|-------|--------------|
| `workflow_started` | `run()` begins |
| `activity_scheduled` | Activity execution starts |
| `activity_completed` | Activity returns a result |
| `activity_failed` | Activity throws an error |
| `query_resolved` | A query is resolved |
| `timer_started` / `timer_fired` | Sleep begins / ends |
| `child_started` / `child_completed` / `child_failed` | Child workflow lifecycle |
| `all_started` / `all_completed` | `all()` lifecycle |
| `race_started` / `race_completed` | `race()` lifecycle |
| `workflow_published` | Workflow published a value |
| `workflow_completed` / `workflow_failed` | Workflow terminal state |

---

## The Type System

### Workflow<A, R>

```mermaid
graph LR
    WF["Workflow&lt;A, R&gt;"]
    A["A = return type"]
    R["R = requirements (queries the workflow needs)"]

    WF --- A
    WF --- R

    R -->|tracks| Q["Query&lt;K, V&gt; tags"]
    Q -->|constrains| signal["hook.signal(name, payload)"]
    Q -->|resolved by| REG["registry (cross-workflow deps)"]
```

`Workflow<A, R>` is a class wrapping a generator factory. `A` is the return type, `R` is a union of `Query<K, V>` requirement tags that propagate upward through composition (like Effect-TS).

**Example:**

```typescript
const checkoutWorkflow = workflow(function* () {
  const [payment, profile] = yield* all(
    query<PaymentInfo>("payment"),
    query<UserProfile>("profile"),
  );
  return yield* activity("place-order", async () => ({
    orderId: "123",
    user: profile.name,
  }));
});
// Type: Workflow<Order, Query<"payment", PaymentInfo> | Query<"profile", UserProfile>>
```

Requirements propagate through `yield*`, `child()`, `all()`, and `race()`. The registry verifies at build time that all requirements are satisfied.

### Descriptors vs Commands

Free functions yield **descriptors** (no `seq`). The interpreter assigns a monotonic `seq` to produce **commands**:

```mermaid
graph LR
    FF["activity('fetch', fn)"] -->|yields| DESC["ActivityDescriptor"]
    DESC -->|interpreter assigns seq| CMD["ActivityCommand { seq: 1 }"]
```

This separation keeps workflow code deterministic — the generator never sees or depends on sequence numbers.

---

## The Registry

The registry manages shared workflow instances, enables cross-workflow dependencies, and handles observer registration for inline workflows.

```mermaid
graph TB
    subgraph "WorkflowRegistry"
        ENTRIES["entries: Map&lt;string, WorkflowEntry&gt;"]

        subgraph "Entry: profile"
            E1_FN["fn: profileWorkflow"]
            E1_INT["interpreter: Interpreter"]
            E1_OBS["observed: false"]
            E1_WAIT["waiters: []"]
            E1_LIST["listeners: [syncState, forceRender]"]
        end

        subgraph "Entry: checkout (observed)"
            E2_FN["fn: (stub)"]
            E2_INT["interpreter: Interpreter"]
            E2_OBS["observed: true"]
            E2_WAIT["waiters: []"]
            E2_LIST["listeners: [forceRender]"]
        end
    end

    BUILD["createRegistry(storage).add('profile', wf).build()"] -->|constructor| ENTRIES
    UW_INLINE["useWorkflow('checkout', fn)"] -->|observe()| ENTRIES
```

### Entry Types

| Field | Purpose |
|-------|---------|
| `fn` | The workflow function (stub for observed entries) |
| `interpreter` | The running interpreter instance |
| `observed` | `true` if added via `observe()`, `false` if from the registry |
| `completed` / `failed` | Terminal state flags |
| `waiters` | Promises from other workflows waiting on this one |
| `listeners` | State change callbacks (from hooks) |

### Cross-Workflow Dependencies

```mermaid
sequenceDiagram
    participant CW as Checkout Workflow
    participant INT_C as Checkout Interpreter
    participant REG as Registry
    participant INT_P as Profile Interpreter
    participant PW as Profile Workflow

    CW->>INT_C: yield query("profile")
    INT_C->>REG: waitFor("profile", { start: true })
    REG->>INT_P: start("profile")
    INT_P->>PW: run()

    Note over PW: Profile is waiting for signal...
    Note over CW: Checkout is blocked

    PW-->>INT_P: completed with UserProfile
    INT_P-->>REG: resolve waiters
    REG-->>INT_C: UserProfile
    INT_C-->>CW: gen.next(UserProfile)
```

### observe / unobserve

Inline workflows register themselves with the registry so other workflows can depend on them:

```
mount:   useWorkflow("checkout", fn) → observe("checkout", interpreter)
unmount: cleanup                     → unobserve("checkout")
```

`observe()` behavior:
- **New entry**: Creates it with `observed: true`, notifies workflows-change listeners
- **Existing observed entry**: Replaces the interpreter (handles React StrictMode re-mounts)
- **Existing registry entry**: No-op (registry workflows are never overridden)

---

## React Integration

### useWorkflow: Two Modes

```mermaid
flowchart TD
    CALL["useWorkflow(id, fn?, options?)"]
    CALL --> CHECK{fn provided?}

    CHECK -->|No| REGISTRY_MODE
    CHECK -->|Yes| INLINE_MODE

    subgraph REGISTRY_MODE["Registry Mode"]
        L1[Get registry from context]
        L2["registry.start(id)"]
        L3["Subscribe to registry.onStateChange"]
        L4[Sync state on every change]
        L1 --> L2 --> L3 --> L4
    end

    subgraph INLINE_MODE["Inline Mode"]
        I1[Load events from storage]
        I2[Create EventLog + Interpreter]
        I3["registry?.observe(id, interpreter)"]
        I4[Subscribe to interpreter.onStateChange]
        I5["interpreter.run()"]
        I6[Persist new events on every change]
        I1 --> I2 --> I3 --> I4 --> I5 --> I6
    end

    REGISTRY_MODE --> RESULT
    INLINE_MODE --> RESULT
    RESULT["{ state, result, error, receiving, signal, reset }"]
```

### Provider Structure

```mermaid
graph TB
    subgraph "Component Tree"
        PROV2["&lt;Provider&gt; (from createBindings)"]
        RC["RegistryContext.Provider"]
        APP["&lt;App /&gt;"]
    end

    PROV2 --> RC --> APP

    REG["WorkflowRegistry"]
    PROV2 -->|value| REG
    RC -->|value| REG

    UW["useWorkflow()"] -->|"useContext(RegistryContext)"| REG
    UWE["useWorkflowEvents()"] -->|"useContext(RegistryContext)"| REG
```

### Signal Flow Through React

```mermaid
sequenceDiagram
    participant UI as Component
    participant HOOK as useWorkflow
    participant INT as Interpreter
    participant LOG as EventLog
    participant STORE as Storage

    UI->>HOOK: signal("submit", formData)
    HOOK->>INT: interpreter.signal("submit", formData)
    INT->>LOG: append(query_resolved)
    INT->>INT: resolve pending promise
    INT->>INT: notifyChange()
    INT-->>HOOK: syncState callback
    HOOK->>HOOK: setState(interpreter.state)
    HOOK->>STORE: persistEvents()
    HOOK-->>UI: re-render with new state
```

### React StrictMode

StrictMode runs effects twice: mount → cleanup → remount. The hook handles this:

```mermaid
sequenceDiagram
    participant React
    participant Effect as useEffect
    participant Registry

    React->>Effect: First mount
    Effect->>Effect: start() → async, yields at await load()
    React->>Effect: Cleanup (cancelled = true)
    Effect->>Registry: unobserve("checkout") — no-op, entry doesn't exist yet
    React->>Effect: Second mount
    Effect->>Effect: start() → async, yields at await load()

    Note over Effect: First mount's microtask resumes
    Effect->>Registry: observe("checkout", interpreter1)

    Note over Effect: Second mount's microtask resumes
    Effect->>Registry: observe("checkout", interpreter2)
    Note over Registry: Replaces interpreter1 with interpreter2<br/>(entry is observed, so replacement is allowed)

    Note over Effect: interpreter2 is the active one<br/>interpreter1 is cancelled and ignored
```

---

## Storage and Persistence

```mermaid
graph LR
    subgraph "WorkflowStorage interface"
        LOAD["load(id) → Event[]"]
        APPEND["append(id, events)"]
        CLEAR["clear(id)"]
    end

    subgraph "MemoryStorage"
        MAP["Map&lt;string, Event[]&gt;"]
    end

    subgraph "LocalStorage"
        LS["window.localStorage"]
        KEY["key: {prefix}:{workflowId}"]
        JSON["value: JSON array"]
    end

    LOAD --> MAP
    LOAD --> LS
    APPEND --> MAP
    APPEND --> LS
    CLEAR --> MAP
    CLEAR --> LS
```

Events are persisted **incrementally**. The hook tracks `persistedCount` and only appends new events since the last persist. This avoids rewriting the entire log on every state change.

---

## Event Notification System

```mermaid
graph TB
    subgraph "Interpreter"
        NC["notifyChange()"]
        CL["changeListeners[]"]
    end

    subgraph "Registry"
        EL["entry.listeners[]"]
        WCL["workflowChangeListeners[]"]
    end

    subgraph "React Hooks"
        SS["useWorkflow syncState"]
        FR["useWorkflowEvents forceRender"]
        SUB["useWorkflowEvents subscribe"]
    end

    NC -->|calls| CL
    CL -->|includes callback from| EL
    EL -->|includes| SS
    EL -->|includes| FR
    WCL -->|includes| SUB
    SUB -->|re-subscribes to| EL
```

**Notification chain:**
1. Interpreter state changes → `notifyChange()` → calls `changeListeners`
2. Registry's observer callback (set up in `observe()` or `start()`) → iterates `entry.listeners`
3. Hook callbacks: `syncState` updates React state, `forceRender` triggers debug panel re-render
4. When workflows are added/removed → `notifyWorkflowsChange()` → `useWorkflowEvents` re-subscribes

---

## Testing with createTestRuntime

```mermaid
flowchart TD
    CALL["createTestRuntime(workflowFn, options)"]
    CALL --> WRAP[Wrap workflow to intercept activities]
    CALL --> MOCK_REG{workflowResults<br/>provided?}
    MOCK_REG -->|Yes| CREATE_REG[Create mock registry]
    MOCK_REG -->|No| NO_REG[No registry]
    WRAP --> CREATE_INT[Create real Interpreter]
    CREATE_REG --> CREATE_INT
    NO_REG --> CREATE_INT
    CREATE_INT --> AUTO_SIGNAL[Set up auto-signal delivery]
    AUTO_SIGNAL --> RUN["interpreter.run()"]
    RUN --> RESULT[Return workflow result]

    subgraph "Auto-Signal Delivery"
        WAIT[Interpreter enters waiting state]
        WAIT --> MATCH{Matching signal<br/>in queue?}
        MATCH -->|Yes| DELIVER["interpreter.signal(name, payload)"]
        MATCH -->|No| STAY[Stay waiting]
        DELIVER --> REMOVE[Remove from queue]
    end
```

The test runtime uses the **real interpreter** — no mocking of the execution engine. Only activities, signals, and workflow dependencies are stubbed:

```typescript
// Activities: replace async functions with synchronous mocks
const result = await createTestRuntime(workflow, {
  activities: { "send-email": () => ({ sent: true }) },
});

// Signals: auto-delivered when the workflow waits for them
const result = await createTestRuntime(workflow, {
  signals: [{ name: "confirm", payload: { approved: true } }],
});

// Cross-workflow deps: mock other workflow results
const result = await createTestRuntime(workflow, {
  workflowResults: { auth: { userId: "123" } },
});
```

---

## File Map

```
src/
  types.ts              Commands, events, descriptors, storage interface
  event-log.ts          Append-only in-memory event log
  interpreter.ts        Core execution engine (run loop, replay, signals)
  registry.ts           Shared workflow management, cross-workflow deps
  registry-builder.ts   Type-safe builder: createRegistry().add().build()
  storage.ts            MemoryStorage and LocalStorage implementations
  bindings.ts           createBindings() — typed Provider, useWorkflow, usePublished
  registry-provider.tsx RegistryContext (shared React context)
  use-workflow.ts       useWorkflow() hook (inline + registry modes)
  use-published.ts      usePublished() selector hook (useSyncExternalStore)
  use-workflow-events.ts useWorkflowEvents() hook (debug/inspection)
  debug-panel.tsx       WorkflowDebugPanel component
  devtools-data.ts      Framework-agnostic timeline data layer
  test-runtime.ts       createTestRuntime() for testing workflows
  index.ts              Core entry point (React-free)
  react.ts              React bindings entry point
  devtools.ts           Devtools entry point (data layer + React panel)
```

---

## Key Invariants

1. **Event logs are append-only.** Events are never modified or deleted. This is the foundation of replay correctness.

2. **Generators must be deterministic.** Given the same inputs (replayed event results), a workflow must yield the same sequence of commands. Non-determinism is detected and throws.

3. **Sequence numbers are monotonic.** Each command gets the next `seq` value. This is how the interpreter matches commands to their recorded events during replay.

4. **Registry entries are never overridden by observe().** Only entries created via `observe()` (with `observed: true`) can have their interpreter replaced. This prevents inline workflows from clobbering registry-registered workflows.

5. **Storage persistence is incremental.** Only new events (since last persist) are appended. The hook tracks `persistedCount` to avoid redundant writes.

6. **Cleanup cancels but doesn't destroy.** The `cancelled` flag prevents state updates after unmount, but the interpreter may still be running asynchronously. This is safe because the cancelled interpreter's state changes are ignored.

# react-workflow Maintainer's Guide

A durable workflow engine for React. Workflows are generator functions that yield commands; an interpreter executes them, records every step in an append-only event log, and replays from that log on reload.

---

## Architecture Overview

```mermaid
graph TB
    subgraph "React Layer"
        UW["useWorkflow()"]
        UWE["useWorkflowEvents()"]
        WLP["WorkflowLayerProvider"]
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

    WLP -->|creates| REG
    UW -->|layer mode| REG
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

| Command | What it does | Context method |
|---------|-------------|----------------|
| `ActivityCommand` | Run an async function | `ctx.activity(name, fn)` |
| `QueryCommand` | Block until a named query is resolved | `ctx.query(label)` |
| `WaitForAllCommand` | Block until multiple signals and/or workflows resolve | `ctx.waitForAll(...)` |
| `JoinCommand` | Block until another workflow completes | `ctx.join(id)` |
| `PublishedCommand` | Block until another workflow publishes a value | `ctx.published(id)` |
| `SleepCommand` | Block for a duration | `ctx.sleep(ms)` |
| `ParallelCommand` | Run multiple activities concurrently | `ctx.parallel(activities)` |
| `ChildCommand` | Run a child workflow with its own event log | `ctx.child(name, fn)` |

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
| `wait_all_started` / `wait_all_completed` | Heterogeneous wait lifecycle |
| `workflow_dependency_started` / `workflow_dependency_completed` | Cross-workflow dependency |
| `workflow_completed` / `workflow_failed` | Workflow terminal state |

---

## The Type System

### Three Generics on WorkflowFunction

```mermaid
graph LR
    WF["WorkflowFunction&lt;T, SignalMap, WorkflowMap&gt;"]
    T["T = return type"]
    SM["SignalMap = signal names → payload types"]
    WM["WorkflowMap = workflow IDs → result types"]

    WF --- T
    WF --- SM
    WF --- WM

    SM -->|constrains| receive["ctx.query(label)"]
    SM -->|constrains| waitForAll["ctx.waitForAll(...)"]
    SM -->|constrains| signal["hook.signal(name, payload)"]
    WM -->|constrains| wfw["ctx.join(id) / ctx.published(id)"]
    WM -->|constrains| wref["ctx.workflow(id)"]
```

**Example:**

```typescript
type CheckoutSignals = { payment: PaymentInfo };
type CheckoutDeps = { profile: UserProfile };

const checkoutWorkflow: WorkflowFunction<
  OrderConfirmation,    // T: what the workflow returns
  CheckoutSignals,      // SignalMap: what signals it accepts
  CheckoutDeps          // WorkflowMap: what workflows it depends on
> = function* (ctx) {
  const [payment, profile] = yield* ctx.waitForAll(
    "payment",              // TS knows this is PaymentInfo
    ctx.workflow("profile") // TS knows this is UserProfile
  );
  // payment: PaymentInfo, profile: UserProfile
};
```

### WorkflowContext vs InternalWorkflowContext

```mermaid
graph TB
    subgraph "User-facing (generic)"
        WC["WorkflowContext&lt;SignalMap, WorkflowMap&gt;"]
        WC1["query&lt;K&gt;(label: K) → SignalMap[K]"]
        WC2["join&lt;K&gt;(id: K) → WorkflowMap[K]"]
        WC2b["published&lt;K&gt;(id: K) → WorkflowMap[K]"]
        WC3["waitForAll(...) → mapped tuple"]
    end

    subgraph "Internal (type-erased)"
        IWC["InternalWorkflowContext"]
        IWC1["query(label: string) → unknown"]
        IWC2["join(id: string) → unknown"]
        IWC2b["published(id: string) → unknown"]
        IWC3["waitForAll(...) → unknown"]
    end

    WC -.->|"as unknown as"| IWC
    IWC -.->|"as unknown as"| WC

    style WC fill:#e8f5e9
    style IWC fill:#fff3e0
```

The interpreter constructs an `InternalWorkflowContext` (unconstrained) and casts it to `WorkflowContext` when calling the workflow function. This is safe because:

- The interpreter never reads from `SignalMap` or `WorkflowMap` — it only passes the context through
- The user's `WorkflowFunction<T, SignalMap, WorkflowMap>` narrows the types at the call site
- The cast exists because TypeScript can't unify the `waitForAll` mapped-tuple return type with `unknown`

### Heterogeneous waitForAll

`waitForAll` accepts a mix of signal names (strings) and workflow references (`WorkflowRef<T>`). The return type is a tuple that preserves each argument's type:

```typescript
ctx.waitForAll("email", "password", ctx.workflow("profile"))
//          ↓ string  ↓ string   ↓ WorkflowRef<UserProfile>
// returns: [string,   string,    UserProfile]
```

The mapped tuple type:
```typescript
{
  [I in keyof K]: K[I] extends WorkflowRef<infer R>
    ? R
    : K[I] extends keyof SignalMap & string
      ? SignalMap[K[I]]
      : never
}
```

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

    LAYER["createLayer({ profile }, storage)"] -->|constructor| ENTRIES
    UW_INLINE["useWorkflow('checkout', fn)"] -->|observe()| ENTRIES
```

### Entry Types

| Field | Purpose |
|-------|---------|
| `fn` | The workflow function (stub for observed entries) |
| `interpreter` | The running interpreter instance |
| `observed` | `true` if added via `observe()`, `false` if from the layer |
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

    CW->>INT_C: yield join("profile")
    INT_C->>REG: waitForCompletion("profile", { start: true })
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
- **Existing layer entry**: No-op (layer workflows are never overridden)

---

## React Integration

### useWorkflow: Two Modes

```mermaid
flowchart TD
    CALL["useWorkflow(id, fn?, options?)"]
    CALL --> CHECK{fn provided?}

    CHECK -->|No| LAYER_MODE
    CHECK -->|Yes| INLINE_MODE

    subgraph LAYER_MODE["Layer Mode"]
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

    LAYER_MODE --> RESULT
    INLINE_MODE --> RESULT
    RESULT["{ state, result, error, receiving, signal, reset }"]
```

### Provider Structure

```mermaid
graph TB
    subgraph "Component Tree"
        SLP["&lt;WorkflowLayerProvider layer={layer}&gt;"]
        LRC["LayerRegistryContext.Provider"]
        RC["RegistryContext.Provider"]
        APP["&lt;App /&gt;"]
    end

    SLP --> LRC --> RC --> APP

    REG["WorkflowRegistry"]
    SLP -->|"useMemo → new"| REG
    LRC -->|value| REG
    RC -->|value| REG

    UW["useWorkflow()"] -->|"useContext(RegistryContext)"| REG
    UWE["useWorkflowEvents()"] -->|"useContext(RegistryContext)"| REG
    ULR["useLayerRegistry()"] -->|"useContext(LayerRegistryContext)"| REG
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
  types.ts              Commands, events, context types, storage interface
  event-log.ts          Append-only in-memory event log
  interpreter.ts        Core execution engine (run loop, replay, signals)
  registry.ts           Shared workflow management, cross-workflow deps
  storage.ts            MemoryStorage and LocalStorage implementations
  layer.ts              createLayer() factory
  layer-provider.tsx    WorkflowLayerProvider component
  registry-provider.tsx RegistryContext (shared React context)
  use-workflow.ts       useWorkflow() hook (inline + layer modes)
  use-workflow-events.ts useWorkflowEvents() hook (debug/inspection)
  debug-panel.tsx       WorkflowDebugPanel component
  test-runtime.ts       createTestRuntime() for testing workflows
  index.ts              Public API exports
```

---

## Key Invariants

1. **Event logs are append-only.** Events are never modified or deleted. This is the foundation of replay correctness.

2. **Generators must be deterministic.** Given the same inputs (replayed event results), a workflow must yield the same sequence of commands. Non-determinism is detected and throws.

3. **Sequence numbers are monotonic.** Each command gets the next `seq` value. This is how the interpreter matches commands to their recorded events during replay.

4. **Layer entries are never overridden by observe().** Only entries created via `observe()` (with `observed: true`) can have their interpreter replaced. This prevents inline workflows from clobbering layer-registered workflows.

5. **Storage persistence is incremental.** Only new events (since last persist) are appended. The hook tracks `persistedCount` to avoid redundant writes.

6. **Cleanup cancels but doesn't destroy.** The `cancelled` flag prevents state updates after unmount, but the interpreter may still be running asynchronously. This is safe because the cancelled interpreter's state changes are ignored.

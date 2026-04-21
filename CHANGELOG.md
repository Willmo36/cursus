# Changelog

## 0.1.0 (Unreleased)

Initial release.

### Core

- Generator-based workflow engine with event-sourcing replay
- `workflow(fn)` wraps a generator as a composable `Workflow<A, R>` class
- `activity(name, fn)` for side effects. Return type is constrained to `Serializable<T>` — non-serializable returns (functions, `Map`, class instances) are rejected at compile time.
- `receive(label).as<V>()` to wait for an external `signal(label, payload)`. Payload `V` is constrained to `Serializable<V>`.
- `ask(label).as<V>()` to resolve a value from another registered workflow. Value is re-hydrated live on replay and never serialized, so `V` is unconstrained — non-serializable values (service bundles, class instances) are safe.
- `sleep(ms)` for durable timers that survive page reload
- `child(name, wf)` for nested sub-workflows via `yield*`
- `all(...branches)` for concurrent parallel waits
- `race(...branches)` for concurrent branch racing with automatic cleanup
- `handler().on(signal, fn).as<T>()` for multi-signal receive loops
- `loop(body)` / `loopBreak(value)` for repeating patterns (e.g. retry)
- `publish(value)` for exposing intermediate workflow state to consumers. Value is never serialized — kept in memory and recomputed on replay.
- `cancel()` with `AbortSignal` propagation to in-flight activities
- `Workflow.map()` and `Workflow.provide()` combinators

### Event log shape

Only two events carry payload data: `activity_completed.result` and `receive_resolved.value`. All other value-bearing positions (`publish`, `return`, `loopBreak`, `all`/`race` results, child returns) are recomputed in memory on replay. This keeps workflows free to return non-serializable values while preserving replay determinism.

`EVENT_SCHEMA_VERSION = 5`.

### Cross-Workflow Dependencies

- `WorkflowRegistry` for shared workflow instance management
- `ask(id)` resolves against the registry (published value → completed → wait). Re-hydrates from the registry on every replay.
- Circular dependency detection (DFS-based, throws immediately with full cycle path)
- Fail-fast error propagation in `all` when a dependency fails

### React Integration

- `useWorkflow(id, fn, options)` hook with two modes: inline (standalone) and registry (pre-registered)
- `createRegistry(storage).add(id, wf).build()` / `createBindings(registry)` for typed workflow registries
- `usePublished(id, selector)` for selecting slices of published state with memoization
- `useWorkflowEvents()` hook for observing workflow events in real time
- `WorkflowDebugPanel` component with event log viewer and timeline
- Registry `merge()` for composing registries across modules

### Storage

- `LocalStorage` for browser persistence (prefixed `localStorage` keys)
- `MemoryStorage` for tests and ephemeral use
- Pluggable `WorkflowStorage` interface for custom backends
- Workflow versioning with automatic stale storage detection

No compaction: completed workflows retain their full event log so replay on remount reproduces the result without re-running side effects. Storage size grows with workflow length.

### Testing

- `createTestRuntime(workflowFn, options)` with mock activities, pre-queued signals, and workflow result stubs

### Examples

- `login` — credential validation with retry loop
- `sso-login` — OAuth-style token exchange
- `wizard` — sequential email-then-password flow
- `job-application` — multi-step form with child workflows
- `cookie-banner` — result derived from event log history
- `chat-room` — long-running workflow with repeated signals
- `checkout` — cross-workflow dependency (profile + checkout)
- `shop` — multi-workflow registry with error simulation
- `env-config` — workflow as environment provider
- `error-recovery` — dependency failure handling
- `race` — fetch-with-timeout pattern
- `ssr` — server-side execution with snapshot hydration
- `opentelemetry` — event observer integration
- `publish` — intermediate state via `publish`
- `merge` — type-safe registry merging
- `user-list` — multi-signal handler loop with `handler()`

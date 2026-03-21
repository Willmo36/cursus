# Changelog

## 0.1.0 (Unreleased)

Initial release.

### Core

- Generator-based workflow engine with event-sourcing replay
- `workflow(fn)` wraps a generator as a composable `Workflow<A, R>` class
- `activity(name, fn)` for side effects (API calls, computations, etc.)
- `query(label)` to pause until a named query is resolved (signal or cross-workflow dep)
- `sleep(ms)` for durable timers that survive page reload
- `child(name, wf)` for nested sub-workflows via `yield*`
- `all(...branches)` for concurrent parallel waits
- `race(...branches)` for concurrent branch racing with automatic cleanup
- `handler().on(signal, fn).as<T>()` for multi-signal receive loops
- `loop(body)` / `loopBreak(value)` for repeating patterns (e.g. retry)
- `publish(value)` for exposing intermediate workflow state to consumers
- `cancel()` with `AbortSignal` propagation to in-flight activities
- `Workflow.map()` and `Workflow.provide()` combinators

### Cross-Workflow Dependencies

- `WorkflowRegistry` for shared workflow instance management
- `query(id)` resolves against the registry (published value → completed → wait)
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
- Automatic storage compaction after workflow completion
- Workflow versioning with automatic stale storage detection

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

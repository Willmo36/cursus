# Changelog

## 0.1.0 (Unreleased)

Initial release.

### Core

- Generator-based workflow engine with event-sourcing replay
- `activity(name, fn)` for side effects (API calls, timers, etc.)
- `waitFor(signal)` to pause until external input arrives
- `waitForAny(...signals)` to pause until any of several signals arrives
- `waitAll(...items)` for heterogeneous parallel waits (signals + workflow refs)
- `sleep(ms)` for durable timers that survive page reload
- `child(name, workflowFn)` for nested sub-workflows via `yield*`
- `race(...branches)` for concurrent branch racing with automatic cleanup
- `on(handlers)` / `done(value)` for event-loop style signal handling
- `query(name, handler)` for exposing live workflow state to external reads
- `cancel()` with `AbortSignal` propagation to in-flight activities
- `withRetry(fn, policy)` HOF for activity retry with fixed/linear/exponential backoff

### Cross-Workflow Dependencies

- `WorkflowRegistry` for shared workflow instance management
- `waitForWorkflow(id)` to block on another workflow's result
- `workflow(id)` refs for use in `waitAll`
- Circular dependency detection (DFS-based, throws immediately with full cycle path)
- Fail-fast error propagation in `waitAll` when a dependency fails

### React Integration

- `useWorkflow(id, fn, options)` hook with two modes: inline (standalone) and layer (pre-registered)
- `createLayer(workflows, storage)` / `WorkflowLayerProvider` for typed workflow layers
- `useWorkflowEvents(id)` hook for observing workflow events in real time
- `WorkflowDebugPanel` component with event log viewer and timeline

### Storage

- `LocalStorage` for browser persistence (prefixed `localStorage` keys)
- `MemoryStorage` for tests and ephemeral use
- Pluggable `WorkflowStorage` interface for custom backends
- Automatic storage compaction after workflow completion

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
- `shop` — product browse/cart/checkout with real HTTP
- `error-recovery` — dependency failure handling
- `race` — fetch-with-timeout pattern

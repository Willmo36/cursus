# react-workflow TODO

## Design Gaps

- [x] **No error propagation for failed workflow dependencies in waitAll** — Fixed: `failed` guard flag ensures fail-fast cleanup when one of N deps fails. First failure rejects the waitAll, subsequent callbacks become no-ops.

- [x] **Circular dependency deadlock** — Fixed: registry tracks dependency edges in an adjacency list and runs DFS cycle detection when a dependency is added. Throws immediately with the full cycle path.

- [ ] **LocalStorage isn't multi-tab safe** — `storage.ts:44-49`. `append` does read-modify-write without any locking. Two tabs running the same workflow will clobber each other's events. **Planned fix:** wrap `append` and `compact` in `navigator.locks.request()` (Web Locks API) with a no-op fallback for environments that lack it (jsdom, SSR, older browsers).

## Code Quality

- [x] **`isReplayingEvent` is misleadingly named** — Renamed to `hasEvent(type)`.

- [x] **Listener leak in inline useWorkflow** — Fixed: `onStateChange` unsubscribe is now hoisted and called in the effect cleanup.

## Up Next

- [x] **Timeouts** — Implemented via `ctx.race`. Race any command against `ctx.sleep(ms)` to create a timeout. `timeoutMs` removed from `RetryPolicy` — timeout is a workflow-level concern.

- [x] **Retry policies** — Implemented as `withRetry` HOF. Wraps activity functions with configurable retry + backoff (fixed/linear/exponential). Retries are transparent to the event log.

- [x] **Action signal abstraction** — Implemented as `ctx.on(handlers)` / `ctx.done(value)` / `ctx.waitForAny(...signals)`. Cart workflow migrated.

- [ ] **Error handling in `on` handler workflows** — When an `on` handler runs activities or other commands that fail, the error currently propagates as a workflow failure. Need to discuss: should `on` support per-handler error catching, or is the current behavior (handler errors = workflow errors) correct?

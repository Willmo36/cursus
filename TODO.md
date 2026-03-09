# react-workflow TODO

## Examples

Priority: fill gaps in feature coverage and add real-world scenarios.

### Missing feature coverage

- [ ] **Child workflow example** — No example uses `ctx.child()`. Job-application uses sequential `waitFor` instead. Either fix job-application to use `child()` or add a dedicated example.
- [ ] **Timer/expiry example** — `sleep` only appears inside `race`. Need a standalone example showing durable timers, e.g. "complete payment within 10 minutes or reservation expires."
- [ ] **Layer mode example** — Every example uses inline `useWorkflow`. Need one that shows `createLayer` + `WorkflowLayerProvider` as the primary pattern.
- [ ] **Per-example READMEs** — Each example needs a 3-5 line README explaining what it demonstrates and which features it exercises.

### Missing feature combinations

- [ ] **child + error handling** — What happens when a child workflow fails? How do you recover?
- [ ] **on/done + join** — Event-loop style workflow coordinating with other workflows.
- [ ] **race + waitFor** — "Cancel if user navigates away" or "first responder wins."

### Complex scenarios

- [ ] **Approval chain** — Sequential `join` with different actors (manager → director → finance).
- [ ] **Booking with hold** — Reserve (activity), hold for N minutes (sleep), race timeout vs payment (race + waitFor), release on expiry (activity). Classic saga.
- [ ] **Onboarding wizard** — Multi-step with `child` workflows per step, back-button support, progress persistence.

## Design Gaps

- [x] **No error propagation for failed workflow dependencies in waitForAll** — Fixed: `failed` guard flag ensures fail-fast cleanup when one of N deps fails. First failure rejects the waitForAll, subsequent callbacks become no-ops.

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

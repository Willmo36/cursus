# cursus TODO

## Examples

Priority: fill gaps in feature coverage and add real-world scenarios.

### Missing feature coverage

- [ ] **Child workflow example** — No example uses `child()`. Job-application uses sequential queries instead. Either fix job-application to use `child()` or add a dedicated example.
- [ ] **Timer/expiry example** — `sleep` only appears inside `race`. Need a standalone example showing durable timers, e.g. "complete payment within 10 minutes or reservation expires."
- [ ] **Per-example READMEs** — Each example needs a 3-5 line README explaining what it demonstrates and which features it exercises.

### Missing feature combinations

- [ ] **child + error handling** — What happens when a child workflow fails? How do you recover?
- [ ] **handler + query** — `handler()` loop coordinating with other workflows via cross-workflow `query`.
- [ ] **race + query** — "Cancel if user navigates away" or "first responder wins."

### Complex scenarios

- [ ] **Approval chain** — Sequential `query` with different actors (manager → director → finance).
- [ ] **Booking with hold** — Reserve (activity), hold for N minutes (sleep), race timeout vs payment (race + query), release on expiry (activity). Classic saga.
- [ ] **Onboarding wizard** — Multi-step with `child` workflows per step, back-button support, progress persistence.

## Design Gaps

- [x] **No error propagation for failed workflow dependencies in all** — Fixed: `failed` guard flag ensures fail-fast cleanup when one of N deps fails. First failure rejects the `all`, subsequent callbacks become no-ops.
- [x] **Circular dependency deadlock** — Fixed: registry tracks dependency edges in an adjacency list and runs DFS cycle detection when a dependency is added. Throws immediately with the full cycle path.

## Code Quality

- [x] **`isReplayingEvent` is misleadingly named** — Renamed to `hasEvent(type)`.

- [x] **Listener leak in inline useWorkflow** — Fixed: `onStateChange` unsubscribe is now hoisted and called in the effect cleanup.

## Up Next

- [x] **Timeouts** — Implemented via `race`. Race any command against `sleep(ms)` to create a timeout.

- [x] **Retry policies** — Implemented as `loop` + `try/catch` + `sleep` patterns at the workflow level.

- [x] **Action signal abstraction** — Implemented as `handler().on(signal, fn).as<T>()` builder pattern.

- [ ] **Error handling in handler workflows** — When a handler runs activities or other commands that fail, the error currently propagates as a workflow failure. Need to discuss: should `handler` support per-handler error catching, or is the current behavior (handler errors = workflow errors) correct?

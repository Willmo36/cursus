# react-workflow TODO

## Design Gaps

- [ ] **No error propagation for failed workflow dependencies in waitAll** — `workflow_dependency_failed` exists now, but waitAll still doesn't handle the case where one of N items fails. No way for the workflow to handle partial failures.

- [ ] **Circular dependency deadlock** — `registry.ts`. If workflow A depends on workflow B and B depends on A, both hang forever. No detection, no error, no timeout.

- [ ] **LocalStorage isn't multi-tab safe** — `storage.ts:44-49`. `append` does read-modify-write without any locking. Two tabs running the same workflow will clobber each other's events.

## Code Quality

- [ ] **`isReplayingEvent` is misleadingly named** — `interpreter.ts`. It checks "does any event of this type exist in the log?" — correct for its call sites (`workflow_started`, `workflow_completed`, `workflow_failed`) since those are singleton events, but the name implies something broader. Should be `hasEvent(type)`.

- [ ] **Listener leak in inline useWorkflow** — `use-workflow.ts`. `interpreter.onStateChange(syncState)` returns an unsubscribe function that's never called. Since the interpreter is created inside the effect and gets GC'd with its listeners, this is mostly harmless but sloppy.

## Up Next

- [x] **Timeouts** — Implemented via `ctx.race`. Race any command against `ctx.sleep(ms)` to create a timeout. `timeoutMs` removed from `RetryPolicy` — timeout is a workflow-level concern.

- [x] **Retry policies** — Implemented as `withRetry` HOF. Wraps activity functions with configurable retry + backoff (fixed/linear/exponential). Retries are transparent to the event log.

- [x] **Action signal abstraction** — Implemented as `ctx.on(handlers)` / `ctx.done(value)` / `ctx.waitForAny(...signals)`. Cart workflow migrated.

- [ ] **Error handling in `on` handler workflows** — When an `on` handler runs activities or other commands that fail, the error currently propagates as a workflow failure. Need to discuss: should `on` support per-handler error catching, or is the current behavior (handler errors = workflow errors) correct?

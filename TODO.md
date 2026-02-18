# react-workflow TODO

## Design Gaps

- [ ] **No error propagation for failed workflow dependencies in waitAll** — Even after fixing the `.catch()`, there's a design question: what happens when one of N items in a waitAll fails? Currently there's no `workflow_dependency_failed` event type, and no way for the workflow to handle partial failures.

- [ ] **Circular dependency deadlock** — `registry.ts`. If workflow A depends on workflow B and B depends on A, both hang forever. No detection, no error, no timeout.

- [ ] **LocalStorage isn't multi-tab safe** — `storage.ts:44-49`. `append` does read-modify-write without any locking. Two tabs running the same workflow will clobber each other's events.

## Code Quality

- [ ] **`isReplayingEvent` is misleadingly named** — `interpreter.ts`. It checks "does any event of this type exist in the log?" — correct for its call sites (`workflow_started`, `workflow_completed`, `workflow_failed`) since those are singleton events, but the name implies something broader. Should be `hasEvent(type)`.

- [ ] **Listener leak in inline useWorkflow** — `use-workflow.ts`. `interpreter.onStateChange(syncState)` returns an unsubscribe function that's never called. Since the interpreter is created inside the effect and gets GC'd with its listeners, this is mostly harmless but sloppy.

## Up Next

- [ ] **Timeouts** — No built-in way to timeout a `waitFor`, `activity`, or `waitForWorkflow`. A signal that never arrives means the workflow hangs forever. Natural fit as an options bag: `yield* ctx.waitFor("submit", { timeout: 30000 })`. Should throw a `TimeoutError` the workflow can catch. Builds on the existing cancellation infrastructure.

- [ ] **Retry policies** — Failed activities require the workflow to handle retry logic manually. Activity-level retry config (e.g. `{ retries: 3, backoff: "exponential" }`) is more granular than workflow-level restart. Tackle after timeouts since retries benefit from per-attempt timeouts.

- [ ] **Action signal abstraction** — The cart workflow's `waitFor("action")` + `if (action.type === ...)` pattern is a discriminated union dispatch loop. A `match`-style helper could clean it up, but it's a looping construct that doesn't fit cleanly into yield-one-command. Probably better as a userland helper than a core primitive — wait for more examples using the pattern before committing to a core API.

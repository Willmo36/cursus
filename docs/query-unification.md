# Query Unification: Merging `output()` and `receive()` into `query()`

## Problem

In the checkout example, the inner workflow leaks implementation details:

```ts
const [payment, profile] = yield* all(
    receive("payment").as<PaymentInfo>(),   // "I know this comes from a user"
    output("profile").as<UserProfile>(),    // "I know this comes from a workflow"
);
```

Both are "give me a typed value identified by a string label." The checkout workflow
shouldn't need to know *how* a value is supplied — only that it needs one.

If the workflow is going to leak any detail, it should be the *right* detail.
Tying to a specific source (signal vs. workflow) is the wrong detail to leak.

## Proposed Design

### The `query()` primitive

A single consumer primitive that replaces both `output()` and `receive()`:

```ts
const [payment, profile] = yield* all(
    query("payment").as<PaymentInfo>(),
    query("profile").as<UserProfile>(),
);
```

The inner workflow declares *what* it needs, not *where it comes from*.

### Requirement type: `Query<K, V>`

Replaces both `Signal<K, V>` and `Output<K, V>`:

```ts
type Query<K extends string = string, V = unknown> = {
    readonly _tag: "query";
    readonly query: { readonly [P in K]: V };
};
```

A workflow's requirements become a set of `Query` tags. The registry and React
layer are responsible for fulfilling them.

### Workflow as profunctor

A workflow is a function from queries (inputs) to a result (output). This has
profunctor structure:

- **Covariant (output)**: `.map()` — transform the result
- **Contravariant (input)**: `.provide()` — remap how queries are fulfilled

These are fluent methods on the workflow object returned by `workflow()`.
Combinators live on the workflow, not on the registry — they're pure
transformations that produce new workflows.

#### `workflow()` returns a composable object

`workflow()` returns the generator function itself with `.provide()` and `.map()`
attached as properties (same pattern as `receive().as()`). The function remains
callable — no breaking changes to interpreter, registry, or tests.

```ts
export const checkoutWorkflow = workflow(function* () {
    const [payment, profile] = yield* all(
        query("payment").as<PaymentInfo>(),
        query("profile").as<UserProfile>(),
    );
    return { payment, profile };
})
.provide("profile", function* () {
    return yield* query("user-data");
})
.map((order) => ({ ...order, timestamp: Date.now() }));
```

#### `.provide()` — contramap over inputs

Remaps a query's fulfillment. The provider body is itself a workflow — it yields
commands, has its own queries, and returns a value.

```ts
// Simple: wire "profile" to a different query
.provide("profile", function* () {
    return yield* query("user-data").as<UserProfile>();
})

// Composed: build "foo" from multiple sources
.provide("foo", function* () {
    const [bar, baz] = yield* all(
        query("bar"),
        query("baz"),
    );
    return sumFn(bar, baz);
})
```

Provider queries propagate upward. If the provider for "foo" queries "bar" and
"baz", those become new queries on the outer workflow. The provider *removes*
the original query and *adds* its own. The net query set is:

    (workflow queries − provided queries) ∪ (provider queries)

Providers can fan out (one query → multiple sources), collapse (multiple queries
→ one source), or substitute (one query → different query).

Provider composition is associative (contramapping is associative). Identity is
trivial: `.provide("x", function*() { return yield* query("x") })` is a no-op.

#### `.map()` — map over output

Transforms all consumer-visible values — both the final return and any `publish()`
calls. If a workflow publishes `A` and `.map()` maps `A → B`, consumers see `B`.

```ts
const userSummary = workflow(userWorkflowFn)
    .map((user) => ({ displayName: user.name, avatar: user.avatarUrl }));
```

This keeps the functor honest: if the type says a workflow produces `B`, then
everything consumer-visible is `B`. No type lies.

The same generator function can be wrapped with different `.map()` calls for
different registrations.

#### Composition

Both operations chain naturally:

```ts
const adapted = workflow(checkoutFn)
    .provide("profile", function* () {
        const [bar, baz] = yield* all(query("bar"), query("baz"));
        return sumFn(bar, baz);
    })
    .map((order) => ({ ...order, timestamp: Date.now() }));
```

`.provide()` reshapes the input side, `.map()` reshapes the output side. The
generator in between is unchanged.

#### Reusable adapters

Since workflows are values, adapters can be extracted and reused:

```ts
function withVerifiedProfile<W>(w: W) {
    return w.provide("profile", function* () {
        const [user, verified] = yield* all(
            query("user-data").as<UserData>(),
            query("verification").as<boolean>(),
        );
        return { ...user, verified };
    });
}

const adapted1 = withVerifiedProfile(checkoutWorkflow);
const adapted2 = withVerifiedProfile(orderWorkflow);
```

### Trigger policy

Whether a workflow can be auto-started by a query is declared at registration,
not per-dependency. Default is `true` — most workflows should just start when
needed.

```ts
createRegistry(storage)
    .add("profile", profileWorkflow)                        // triggerable (default)
    .add("session", sessionWorkflow, { trigger: false })    // manual start only
    .add("checkout", adapted)
    .build();
```

When a query resolves to a registered workflow, the registry checks the target's
trigger policy. If triggerable, it auto-starts. If not, the query waits until
something else starts it.

### Leftover queries as signals

Queries not matched by a `.provide()` call or a registered workflow ID become
the leftover signal interface that React components must supply externally.

```ts
const registry = createRegistry(storage)
    .add("profile", profileWorkflow)
    .add("checkout", checkoutWorkflow)    // "profile" auto-matched, "payment" is leftover
    .build();

// "payment" doesn't match any registered workflow → exposed as signal contract
// React component supplies it via registry.signal("checkout", "payment", data)
```

### Type-level mechanics

The registry builder tracks `Provides` — the set of workflow IDs and their
result types. `.provide()` on the workflow updates its query set at the type
level. The registry's `add()` checks the final query set against `Provides`.

Queries remaining after all `.provide()` calls form the leftover set — the
signal contract for `useWorkflow`:

```ts
type Leftovers<F, Provides> = {
    // Query keys from F's requirements that aren't in Provides
    [K in QueryKeys<ReqsOf<F>>]: K extends ProvidedKeys ? never : QueryValue<ReqsOf<F>, K>
};
```

### Interpreter dispatch

The interpreter receives a resolution map from the registry at construction time.
For each `query` command:

- If the label has an explicit `.provide()` → execute the provider workflow
- If the label matches a registered workflow ID → `registry.waitFor(label)`
  per trigger policy (auto-matched)
- Otherwise → wait for an external `signal()` call (leftover/signal path)

The registry auto-matches query labels to registered workflow IDs. `.provide()`
is only needed for non-trivial cases: composition, transformation, or remapping
to a different workflow.

### What happens to `handler()`?

`handler()` is sugar built on `loop` + `race` + `receive`. When `receive` becomes
`query`, handler follows naturally — no special handling needed. Its `.on()` calls
produce `Query` requirements because they use `query()` underneath.

```ts
// handler works unchanged, but its internals use query() instead of receive()
const decision = yield* handler()
    .on("approve", (data: ApprovalData, done) => { ... })
    .on("reject", (reason: string, done) => { ... })
    .as<OrderDecision>();
```

Handler queries are always in the "leftover" bucket — you can't wire a loop to a
workflow result (workflows complete once). The registry knows this because the
handler's queries will never match a registered workflow ID (or if they do, the
registry resolves them once and the loop continues waiting for external supply
on subsequent iterations).

### What happens to `publish()`?

`publish()` is orthogonal — it's a *producer* primitive, not a consumer. A workflow
that publishes a value makes it available to other workflows' `query()` calls via
the registry's `waitFor` resolution.

No change needed to `publish()` itself.

## Event model

Single event type for all query resolutions:

```
QueryResolvedEvent {
    type: "query_resolved"
    label: string
    value: unknown
    seq: number
    timestamp: number
}
```

No `source` field. With providers composing arbitrarily (including `pure()`
inline values), tracking the original source is impractical and not useful.
The workflow doesn't care, and the event model shouldn't pretend to know.

## Resolved Decisions

- **Naming**: `query()` and `.provide()` — reads as "workflow queries, provider fulfills"
- **API shape**: Fluent methods on the `workflow()` return type — `.provide()` and `.map()`
  are workflow combinators, not registry methods
- **Event model**: Single `query_resolved` event, no source tracking
- **`map()` and `publish()`**: `.map()` maps all consumer-visible values — both
  return and publish. The functor applies at the workflow boundary.
- **Trigger policy**: Per-workflow at registration, default `true`
- **Handler**: Follows naturally from `query()` replacing `receive()`, no special case

## Migration Path

1. Rename `Step<R>` → `Requires<R>`
2. Add `query()`, `Query<K, V>`, `QueryDescriptor` alongside existing primitives
3. Add `.provide()` and `.map()` to `workflow()` return type (callable function with methods, same pattern as `receive().as()`)
3. Add profunctor law tests (identity, composition, associativity for both `provide` and `map`)
4. Add interpreter dispatch: resolution map for provided queries, signal path for leftovers
5. Migrate call sites from `output()`/`receive()` → `query()`
6. Update `handler()` internals to use `query()` instead of `receive()`
7. Delete `output()`, `receive()`, `Output`, `Signal`

## What This Gets Us

- Inner workflows are truly declarative — they declare needs, not sources
- Registry becomes the single place where supply decisions are made
- `.provide()` and `.map()` give workflows profunctor structure:
  contramap on inputs, map on output — composable, associative, sound
- Fluent API on `workflow()` — familiar chaining for React devs, profunctor
  semantics for the theory-minded
- Providers are workflows themselves — the same primitives (`all`, `query`, etc.)
  work inside providers, so no new concepts to learn
- React components get a clean, typed signal contract for leftovers
- Fewer primitives to learn (`query` + `handler` vs `output` + `receive` + `handler`)
- Shared workflows can be reshaped per-registration via `map()` without modification

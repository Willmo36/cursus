---
sidebar_position: 3
---

# Registries

Registries let you share workflows across your component tree. Instead of each component running its own inline workflow, you define a set of named workflows once and provide them via React context.

This is how you build multi-step flows where different components drive different parts of the same workflow, or where workflows depend on each other's results.

## Creating a Registry

```ts
import { createRegistry, LocalStorage } from "cursus";

const registry = createRegistry(new LocalStorage("my-app"))
  .add("profile", profileWorkflow)
  .add("checkout", checkoutWorkflow)
  .build();
```

The builder tracks types — each `.add()` call registers the workflow's result and signal types.

## Providing the Registry

Use `createBindings` to get a typed `Provider`, `useWorkflow`, and `usePublished`:

```tsx
import { createBindings } from "cursus/react";

const { useWorkflow, usePublished, Provider } = createBindings(registry);

function App() {
  return (
    <Provider>
      <ProfilePage />
      <CheckoutPage />
    </Provider>
  );
}
```

## Consuming Registry Workflows

Use `useWorkflow` with just an ID (no workflow function) to consume a registry workflow:

```tsx
function ProfilePage() {
  const { state, signal } = useWorkflow("profile");

  if (state.status === "waiting") {
    return <ProfileForm onSubmit={(data) => signal("profile", data)} />;
  }

  if (state.status === "completed") {
    return <p>Welcome, {state.result.name}</p>;
  }

  return <p>Loading...</p>;
}
```

Registry workflows are started automatically on first `useWorkflow` call and shared across all consumers.

## Cross-Workflow Dependencies

Workflows can wait on other workflows in the same registry using `query`:

```ts
import { workflow, query, activity } from "cursus";

const checkoutWorkflow = workflow(function* () {
  const payment = yield* query("payment");
  const profile = yield* query("profile");
  return yield* activity("place-order", async () => {
    return `${profile.name}: ${payment}`;
  });
});
```

`query` auto-starts the target workflow if it hasn't been started yet. If it's already completed or published, the result is returned immediately.

### Publish + query

For long-lived workflows that produce a value without completing, use `publish`. Consumers calling `query` get the published value immediately:

```ts
import { workflow, query, publish, activity } from "cursus";

const sessionWorkflow = workflow(function* () {
  const { user } = yield* query("login");
  yield* publish({ user });
  // keeps running — handles revocation, tier changes, etc.
  yield* query("login");
});

const checkoutWorkflow = workflow(function* () {
  const account = yield* query("session");
  return yield* activity("place-order", async () => {
    return `order for ${account.user}`;
  });
});
```

Resolution order for `query` against the registry: published value → completed → wait. If no workflow matches the label, the query falls through to signal.

## Mixing Queries in all

You can mix signal-backed and workflow-backed queries in `all`:

```ts
const [payment, profile] = yield* all(query("payment"), query("profile"));
```

## Inline Workflows Alongside Registries

You can run inline workflows inside a registry provider. They get access to the registry for cross-workflow dependencies:

```tsx
function CheckoutPage() {
  // Inline workflow that depends on the registry's "profile" workflow
  const { state } = useWorkflow("checkout", checkoutWorkflow);
  // ...
}
```

To use different storage for an inline workflow, pass `storage` explicitly in options.

## Circular Dependency Detection

The registry detects circular dependencies at runtime and fails with a clear error:

```
Circular dependency detected: A -> B -> A
```

This applies to both `query` and `all` with workflow generators.

## Merging Registries

Combine registries from different modules:

```ts
const combined = authRegistry.merge(paymentRegistry).build();
```

Overlapping keys must have compatible result types (enforced at compile time). See [API Reference > merge](./api-reference.md#merge) for details.

## Event Observers

Attach observers that fire for every event across all workflows in the registry:

```ts
const registry = createRegistry(storage)
  .add("checkout", checkoutWorkflow)
  .build({
    onEvent: (workflowId, event) => {
      console.log(`[${workflowId}] ${event.type}`);
    },
  });
```

See [Observability](./observability.md) for more.

## Reset

Reset a registry workflow through the hook — this clears storage and restarts:

```tsx
const { reset } = useWorkflow("checkout");
// ...
<button onClick={reset}>Start Over</button>
```

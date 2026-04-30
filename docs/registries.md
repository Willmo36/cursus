---
sidebar_position: 3
---

# Registries

Registries are the runtime for cursus workflows. You define a set of named workflows once, provide them via React context, and any component in the tree can consume them by ID.

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

Workflows read from other workflows in the same registry using `ask()`:

```ts
import { workflow, ask, receive, activity } from "cursus";

const checkoutWorkflow = workflow(function* () {
  const payment = yield* receive("payment").as<PaymentInfo>();
  const profile = yield* ask("profile").as<Profile>();
  return yield* activity("place-order", async () => {
    return `${profile.name}: ${payment.total}`;
  });
});
```

`ask()` auto-starts the target workflow if it hasn't been started yet. If the target has already published a value or completed, the result returns immediately. On replay, the registry re-hydrates the target so `ask()` always returns its current live value — **the value is never stored in the event log**, so workflows can return non-serializable things (service bundles, class instances).

The dependency's version is recorded at resolution time. If you bump a dependency's version, any consumer whose stored log references the old version is automatically wiped and restarted — no manual consumer version bump needed. See [Storage > Dependency Graph Version Busting](./storage.md#dependency-graph-version-busting).

### Publish + ask

For long-lived workflows that produce a value without completing, use `publish`. Consumers calling `ask()` get the published value immediately:

```ts
import { workflow, ask, receive, publish, activity } from "cursus";

const sessionWorkflow = workflow(function* () {
  const { user } = yield* receive("login").as<{ user: string }>();
  yield* publish({ user });
  // keeps running — handles revocation, tier changes, etc.
  yield* receive("revoke");
});

const checkoutWorkflow = workflow(function* () {
  const account = yield* ask("session").as<{ user: string }>();
  return yield* activity("place-order", async () => {
    return `order for ${account.user}`;
  });
});
```

Resolution order for `ask()`: published value → completed → wait for one of those. The registry must have a workflow registered at that label; otherwise `ask()` throws.

## Mixing ask and receive in all

You can mix signal-backed and workflow-backed branches in `all`:

```ts
const [payment, profile] = yield* all(
  receive("payment").as<PaymentInfo>(),
  ask("profile").as<Profile>(),
);
```

## Circular Dependency Detection

The registry detects circular dependencies at runtime and fails with a clear error:

```
Circular dependency detected: A -> B -> A
```

This applies to both `ask` and `all` with workflow generators.

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

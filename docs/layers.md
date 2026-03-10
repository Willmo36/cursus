---
sidebar_position: 3
---

# Layers

Layers let you share workflows across your component tree. Instead of each component running its own inline workflow, you define a set of named workflows once and provide them via React context.

This is how you build multi-step flows where different components drive different parts of the same workflow, or where workflows depend on each other's results.

## Creating a Layer

```ts
import { createLayer, LocalStorage } from "cursus";

const layer = createLayer<{
  profile: { name: string };
  checkout: string;
}>(
  {
    profile: profileWorkflow,
    checkout: checkoutWorkflow,
  },
  new LocalStorage("my-app"),
);
```

The generic parameter maps workflow IDs to their result types.

## Providing the Layer

Wrap your component tree with `WorkflowLayerProvider`:

```tsx
import { WorkflowLayerProvider } from "cursus/react";

function App() {
  return (
    <WorkflowLayerProvider layer={layer}>
      <ProfilePage />
      <CheckoutPage />
    </WorkflowLayerProvider>
  );
}
```

## Consuming Layer Workflows

Use `useWorkflow` with just an ID (no workflow function) to consume a layer workflow:

```tsx
function ProfilePage() {
  const { state, result, waitingFor, signal } = useWorkflow<{ name: string }>("profile");

  if (waitingFor === "profile") {
    return <ProfileForm onSubmit={(data) => signal("profile", data)} />;
  }

  if (state === "completed") {
    return <p>Welcome, {result.name}</p>;
  }

  return <p>Loading...</p>;
}
```

Layer workflows are started automatically on first `useWorkflow` call and shared across all consumers.

## Cross-Workflow Dependencies

Workflows can wait on other workflows in the same layer using `join`:

```ts
const checkoutWorkflow: WorkflowFunction<
  string,
  { payment: string },
  { profile: { name: string } }
> = function* (ctx) {
  const payment = yield* ctx.waitFor("payment");
  const profile = yield* ctx.join("profile");
  return yield* ctx.activity("place-order", async () => {
    return `${profile.name}: ${payment}`;
  });
};
```

The third type parameter (`WorkflowMap`) declares which workflows this one can depend on.

`join` auto-starts the target workflow if it hasn't been started yet. If it's already completed, the result is returned immediately.

### Publish + published

For long-lived workflows that produce a value without completing, use `publish`. Consumers calling `published` get the published value immediately:

```ts
const sessionWorkflow: WorkflowFunction<
  void,
  { login: { user: string } },
  Record<string, never>,
  Record<string, never>,
  { user: string }
> = function* (ctx) {
  const { user } = yield* ctx.waitFor("login");
  yield* ctx.publish({ user });
  // keeps running — handles revocation, tier changes, etc.
  yield* ctx.waitFor("login");
};

const checkoutWorkflow: WorkflowFunction<
  string,
  Record<string, unknown>,
  { session: { user: string } }
> = function* (ctx) {
  const account = yield* ctx.published("session");
  return yield* ctx.activity("place-order", async () => {
    return `order for ${account.user}`;
  });
};
```

Resolution order for `published`: published value → wait. Resolution order for `join`: completed → failed → wait.

## Mixing Signals and Workflows in all

You can mix signals and workflow dependencies in `all`:

```ts
const [payment, profile] = yield* ctx.all(ctx.waitFor("payment"), ctx.workflow("profile"));
```

`ctx.workflow("id")` returns a generator that resolves through the registry, just like `ctx.join("id")`.

## Inline Workflows Alongside Layers

You can run inline workflows inside a layer provider. They get access to the layer's registry for cross-workflow dependencies, and use the layer's storage by default:

```tsx
function CheckoutPage() {
  // Inline workflow that depends on the layer's "profile" workflow
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

This applies to both `join` / `published` and `all` with workflow generators.

## Layer Options

### Versioning

See [Storage > Versioning](./storage.md#versioning) for details.

```ts
const layer = createLayer<{ checkout: string; profile: Profile }>(
  { checkout: checkoutWorkflow, profile: profileWorkflow },
  storage,
  { versions: { checkout: 2 } },
);
```

### Event Observers

Attach observers that fire for every event across all workflows in the layer:

```ts
const layer = createLayer(workflows, storage, {
  onEvent: (workflowId, event) => {
    console.log(`[${workflowId}] ${event.type}`);
  },
});
```

See [Observability](./observability.md) for more.

## Reset

Reset a layer workflow through the hook — this clears storage and restarts:

```tsx
const { reset } = useWorkflow("checkout");
// ...
<button onClick={reset}>Start Over</button>
```

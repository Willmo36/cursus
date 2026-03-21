---
sidebar_position: 8
---

# SSR & Hydration

Cursus workflows run inside `useEffect`, which doesn't execute on the server. Without SSR support, server-rendered pages always show the initial "running" state, causing a loading flash on hydration.

`runWorkflow()` solves this by executing a workflow on the server and producing a serializable snapshot. Pass the snapshot to `useWorkflow` on the client so the initial render matches the server output.

## How It Works

1. **Server**: `runWorkflow()` executes the workflow and returns a `WorkflowSnapshot`
2. **Transport**: You serialize the snapshot however your framework requires (RSC props, `<script>` tag, loader data, etc.)
3. **Client**: `useWorkflow` uses the snapshot for `useState` initializers, then seeds events into storage for replay

The interpreter replays from the event log — it never re-executes activities that already ran on the server.

## Server-Side Execution

```ts
import { runWorkflow, MemoryStorage } from "cursus";

const snapshot = await runWorkflow("checkout", checkoutWorkflow);
// snapshot.state.status === "completed"
// snapshot.state.result === { orderId: "123" }
// snapshot.events === [ ... full event log ... ]
```

`runWorkflow` accepts an optional storage:

```ts
const snapshot = await runWorkflow("checkout", checkoutWorkflow, {
  storage: new MemoryStorage(),
});
```

If the workflow blocks on a query (e.g. `query`), `runWorkflow` returns immediately with `state.status === "waiting"`. The snapshot captures events up to the blocking point.

## Client-Side Hydration

Pass the snapshot to `useWorkflow`:

```tsx
import { useWorkflow } from "cursus/react";

function CheckoutPage({ snapshot }) {
  const { state } = useWorkflow("checkout", checkoutWorkflow, {
    storage,
    snapshot,
  });

  // First render uses snapshot values — no loading flash
  if (state.status === "completed") {
    return <OrderConfirmation order={state.result} />;
  }
  // ...
}
```

### Behavior by Snapshot State

| Snapshot state | Client behavior |
|---|---|
| `completed` / `failed` | No interpreter runs. State is initialized from snapshot. |
| `waiting` | Events are seeded into storage. Interpreter replays to the waiting point and resumes. |
| `running` | Events are seeded. Interpreter replays and continues executing remaining steps. |

## WorkflowSnapshot Type

```ts
type WorkflowSnapshot = {
  workflowId: string;
  events: WorkflowEvent[];
  state: WorkflowState;
  published: unknown;
};
```

All fields are JSON-serializable, so you can `JSON.stringify` the snapshot for any transport mechanism.

## Framework Examples

### Next.js (App Router)

```tsx
// app/checkout/page.tsx
import { runWorkflow } from "cursus";

export default async function CheckoutPage() {
  const snapshot = await runWorkflow("checkout", checkoutWorkflow);
  return <CheckoutClient snapshot={snapshot} />;
}
```

```tsx
// app/checkout/checkout-client.tsx
"use client";
import { useWorkflow } from "cursus/react";

export function CheckoutClient({ snapshot }) {
  const wf = useWorkflow("checkout", checkoutWorkflow, { storage, snapshot });
  // ...
}
```

### Remix / React Router

```tsx
export async function loader() {
  const snapshot = await runWorkflow("checkout", checkoutWorkflow);
  return { snapshot };
}

export default function Checkout() {
  const { snapshot } = useLoaderData();
  const wf = useWorkflow("checkout", checkoutWorkflow, { storage, snapshot });
  // ...
}
```

### Manual (`<script>` tag)

```html
<script>
  window.__WORKFLOW_SNAPSHOT__ = ${JSON.stringify(snapshot)};
</script>
```

```tsx
const snapshot = (window as any).__WORKFLOW_SNAPSHOT__;
const wf = useWorkflow("checkout", checkoutWorkflow, { storage, snapshot });
```

## Limitations

- **Signals**: Workflows that block on signals return `state.status === "waiting"`. The client must provide the signal to continue.
- **Timers**: `sleep()` blocks `runWorkflow` for the full duration. Avoid long sleeps in server-executed workflows.
- **Cross-workflow deps**: `runWorkflow` doesn't support `query` for cross-workflow dependencies — these require a registry, which is a client-side concept. Workflows that use cross-workflow `query` should be hydrated via layers, not `runWorkflow`.

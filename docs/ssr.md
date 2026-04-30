---
sidebar_position: 8
---

# SSR & Hydration

Cursus workflows run inside `useEffect`, which doesn't execute on the server. Without SSR support, server-rendered pages always show the initial "running" state, causing a loading flash on hydration.

The SSR pattern: run the registry on the server with `runRegistry()`, serialize the resulting snapshots, and seed them into storage on the client before mounting. The client's registry replays from those events and picks up where the server left off — no loading flash, no duplicate activity calls.

## How It Works

1. **Server**: Call `runRegistry(registry)` — starts each workflow, waits for it to settle (complete or block on `receive`), returns a per-workflow snapshot
2. **Transport**: Pass the snapshots however your framework requires (`<script>` tag, RSC props, loader data)
3. **Client**: Seed the snapshot events into storage before mounting the registry `Provider`

The interpreter replays from the seeded events — activities fast-forward from stored results, no side effects re-fire.

## Server-Side Execution

```ts
import { createRegistry, MemoryStorage, runRegistry } from "cursus";
import { productWorkflow } from "./workflow";

const registry = createRegistry(new MemoryStorage())
  .add("product", productWorkflow)
  .build();

const snapshots = await runRegistry(registry);
// snapshots.product.state   — WorkflowState (completed / waiting / failed)
// snapshots.product.events  — WorkflowEvent[] (the full event log)
// snapshots.product.published — the published value, if any
```

`runRegistry` runs all registered workflows by default. Pass an array of IDs to run a subset:

```ts
const snapshots = await runRegistry(registry, ["product"]);
```

If a workflow blocks on `receive`, `runRegistry` returns immediately with `state.status === "waiting"` for that workflow. The snapshot captures events up to the blocking point.

## Client-Side Hydration

Seed the snapshot events into storage before mounting:

```tsx
import { createRegistry, LocalStorage } from "cursus";
import type { WorkflowSnapshot } from "cursus";
import { createBindings } from "cursus/react";
import { hydrateRoot } from "react-dom/client";
import { productWorkflow } from "./workflow";

const snapshot: WorkflowSnapshot = window.__SNAPSHOT__;

// Seed server-produced events so the registry replays without re-running activities
const storage = new LocalStorage("ssr");
await storage.append(snapshot.workflowId, snapshot.events);

const registry = createRegistry(storage)
  .add("product", productWorkflow)
  .build();

const { Provider } = createBindings(registry);

hydrateRoot(
  document.getElementById("root")!,
  <Provider>
    <App snapshot={snapshot} />
  </Provider>,
);
```

Inside the app, `useWorkflow("product")` picks up the registry's replayed state immediately — no loading flash:

```tsx
function App({ snapshot }: { snapshot: WorkflowSnapshot }) {
  const { state, published, signal, reset } = useWorkflow("product");
  // state matches the server-rendered state on first render
}
```

## WorkflowSnapshot Type

```ts
type WorkflowSnapshot = {
  workflowId: string;
  events: WorkflowEvent[];
  state: WorkflowState;
  published: unknown;
};
```

All fields are JSON-serializable. The event log only stores activity results and receive payloads — `publish` and `return` values are reproduced live by replay on the client, so workflows that publish non-serializable values still SSR correctly as long as their activity/receive inputs are serializable.

## Framework Examples

### Next.js (App Router)

```tsx
// app/product/page.tsx
import { createRegistry, MemoryStorage, runRegistry } from "cursus";
import { productWorkflow } from "./workflow";

export default async function ProductPage() {
  const registry = createRegistry(new MemoryStorage())
    .add("product", productWorkflow)
    .build();

  const snapshots = await runRegistry(registry);

  return <ProductClient snapshot={snapshots.product} />;
}
```

```tsx
// app/product/product-client.tsx
"use client";
import { createRegistry, LocalStorage } from "cursus";
import type { WorkflowSnapshot } from "cursus";
import { createBindings } from "cursus/react";
import { productWorkflow } from "./workflow";

export async function ProductClient({ snapshot }: { snapshot: WorkflowSnapshot }) {
  const storage = new LocalStorage("product");
  await storage.append(snapshot.workflowId, snapshot.events);

  const registry = createRegistry(storage)
    .add("product", productWorkflow)
    .build();

  const { Provider } = createBindings(registry);

  return (
    <Provider>
      <ProductPage snapshot={snapshot} />
    </Provider>
  );
}
```

### Remix / React Router

```tsx
// routes/product.tsx
import { createRegistry, MemoryStorage, runRegistry } from "cursus";

export async function loader() {
  const registry = createRegistry(new MemoryStorage())
    .add("product", productWorkflow)
    .build();

  const snapshots = await runRegistry(registry);
  return { snapshot: snapshots.product };
}

export default function Product() {
  const { snapshot } = useLoaderData();
  // Seeding must happen before the registry mounts —
  // do it in your client entry point before hydrateRoot.
}
```

### Manual (`<script>` tag)

```ts
// server
const snapshots = await runRegistry(registry);
res.send(`
  <script>window.__SNAPSHOT__ = ${JSON.stringify(snapshots.product)}</script>
`);
```

```tsx
// client entry
import type { WorkflowSnapshot } from "cursus";

const snapshot = (window as any).__SNAPSHOT__ as WorkflowSnapshot;
await storage.append(snapshot.workflowId, snapshot.events);
// then mount with Provider
```

## Limitations

- **Signals**: Workflows that block on `receive` settle with `state.status === "waiting"`. The client must provide the signal to continue.
- **Timers**: `sleep()` inside a workflow causes `runRegistry` to wait for the full duration for that workflow. Avoid long sleeps in server-executed workflows; model them as `race(sleep, receive)` instead.
- **Cross-workflow deps**: Register all mutually-dependent workflows in the same server registry. `runRegistry` starts them in parallel — `ask()` dependencies are resolved by the registry as workflows complete.
- **Non-serializable published values**: `published` is serialized into the snapshot for transport. A workflow that publishes a non-serializable value (a class instance, service bundle) will have `published: undefined` after JSON round-trip. The client registry reconstructs the value live via replay — so the component sees the correct value after hydration, just not in the initial server render.

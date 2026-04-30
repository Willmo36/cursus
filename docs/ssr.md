---
sidebar_position: 8
---

# SSR & Hydration

Cursus workflows run inside `useEffect`, which doesn't execute on the server. Without SSR support, server-rendered pages always show the initial "running" state, causing a loading flash on hydration.

The SSR pattern: run the workflow via a registry on the server, serialize the resulting event log as a snapshot, and seed it into storage on the client before mounting. The client's registry replays from those events and picks up where the server left off — no loading flash, no duplicate activity calls.

## How It Works

1. **Server**: Build a registry with `MemoryStorage`, start the target workflow, wait for it to settle (complete or block on `receive`), serialize the events
2. **Transport**: Pass the snapshot however your framework requires (`<script>` tag, RSC props, loader data)
3. **Client**: Seed the snapshot events into `LocalStorage` before mounting the registry `Provider`

The interpreter replays from the seeded events — activities fast-forward from stored results, no side effects re-fire.

## Server-Side Execution

```ts
import { createRegistry, MemoryStorage } from "cursus";
import { productWorkflow } from "./workflow";

const storage = new MemoryStorage();
const registry = createRegistry(storage)
  .add("product", productWorkflow)
  .build();

// Start the workflow and wait for it to settle
await new Promise<void>((resolve) => {
  let resolved = false;

  registry._registry.onStateChange("product", () => {
    if (resolved) return;
    const state = registry.getState("product");
    if (state && (state.status === "completed" || state.status === "waiting" || state.status === "failed")) {
      resolved = true;
      resolve();
    }
  });

  registry.start("product").then(() => {
    if (!resolved) { resolved = true; resolve(); }
  });
});

const state = registry.getState("product") ?? { status: "running" };
const events = registry.getEvents("product");
const published = registry._registry.getInterpreter("product")?.published;

const snapshot = { workflowId: "product", events, state, published };
```

If the workflow blocks on `receive`, `registry.start()` never resolves — the `onStateChange` listener catches the `"waiting"` state and resolves the Promise. If the workflow completes without blocking, `start()` resolves and the promise settles immediately.

## Client-Side Hydration

Seed the snapshot events into storage before mounting:

```tsx
import { createRegistry, LocalStorage } from "cursus";
import { createBindings } from "cursus/react";
import { hydrateRoot } from "react-dom/client";
import { productWorkflow } from "./workflow";

const snapshot = window.__SNAPSHOT__;

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

Inside the app, `useWorkflow("product")` picks up the registry's replayed state immediately:

```tsx
function App({ snapshot }) {
  const { state, published, signal, reset } = useWorkflow("product");
  // state matches the server-rendered state on first render — no flash
}
```

## Framework Examples

### Next.js (App Router)

```tsx
// app/product/page.tsx
import { createRegistry, MemoryStorage } from "cursus";
import { productWorkflow } from "./workflow";

export default async function ProductPage() {
  const storage = new MemoryStorage();
  const registry = createRegistry(storage)
    .add("product", productWorkflow)
    .build();

  await new Promise<void>((resolve) => {
    let resolved = false;
    registry._registry.onStateChange("product", () => {
      if (resolved) return;
      const s = registry.getState("product");
      if (s && s.status !== "running") { resolved = true; resolve(); }
    });
    registry.start("product").then(() => { if (!resolved) { resolved = true; resolve(); } });
  });

  const snapshot = {
    workflowId: "product",
    events: registry.getEvents("product"),
    state: registry.getState("product") ?? { status: "running" },
    published: registry._registry.getInterpreter("product")?.published,
  };

  return <ProductClient snapshot={snapshot} />;
}
```

```tsx
// app/product/product-client.tsx
"use client";
import { createRegistry, LocalStorage } from "cursus";
import { createBindings } from "cursus/react";
import { productWorkflow } from "./workflow";

export async function ProductClient({ snapshot }) {
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
export async function loader() {
  const storage = new MemoryStorage();
  const registry = createRegistry(storage)
    .add("product", productWorkflow)
    .build();

  await new Promise<void>((resolve) => {
    let resolved = false;
    registry._registry.onStateChange("product", () => {
      if (resolved) return;
      const s = registry.getState("product");
      if (s && s.status !== "running") { resolved = true; resolve(); }
    });
    registry.start("product").then(() => { if (!resolved) { resolved = true; resolve(); } });
  });

  return {
    snapshot: {
      workflowId: "product",
      events: registry.getEvents("product"),
      state: registry.getState("product") ?? { status: "running" },
      published: registry._registry.getInterpreter("product")?.published,
    },
  };
}

export default function Product() {
  const { snapshot } = useLoaderData();
  // Seeding events must happen before rendering; do it in a client-side entry point
  // or use a useLayoutEffect to seed before useWorkflow fires.
}
```

## Limitations

- **Signals**: Workflows that block on `receive` return `state.status === "waiting"`. The client must provide the signal to continue.
- **Timers**: `sleep()` causes `registry.start()` to never resolve for the duration. Avoid long sleeps in server-executed workflows; use `race(sleep, receive)` instead.
- **Cross-workflow deps**: The server-side registry runs all registered workflows. For workflows that depend on each other via `ask()`, register all of them in the server registry. The dependency chain runs to completion before you read events.
- **Non-serializable published values**: `published` is serialized into the snapshot for transport. If a workflow publishes a non-serializable value (a class instance, service bundle), the snapshot's `published` field will be `undefined` after JSON round-trip — but the client registry will reconstruct the value live via replay.

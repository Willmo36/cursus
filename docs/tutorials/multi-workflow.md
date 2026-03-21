---
sidebar_position: 2
---

# Tutorial: E-Commerce with Multiple Workflows

Build a multi-workflow e-commerce app where authentication, profile, cart, and checkout are separate workflows that depend on each other. You'll use typed registries, cross-workflow dependencies, registry merging, and the `usePublished` selector hook.

By the end you'll understand:

- `createRegistry` and `createBindings` for type-safe registries
- Cross-workflow `query` dependencies
- `publish` for shared intermediate state
- `merge` for composing registries across modules
- `usePublished` for efficient state selection

This tutorial assumes you've completed the [Todo App tutorial](./todo-app.md).

## The Architecture

Four workflows form a dependency chain:

```
login ──→ session ──→ checkout
                 ↑
           cart ──┘
```

- **login** — collects credentials, authenticates, returns a user
- **session** — queries login's result, publishes the active user, handles logout
- **cart** — manages items via signals, publishes the cart contents
- **checkout** — queries both session and cart, places the order

## Step 1: The Auth Module

Start with a self-contained auth module that has its own registry:

```ts
// src/auth.ts
import { workflow, query, activity, publish, handler } from "cursus";
import { createRegistry } from "cursus";

export type User = { name: string; email: string };

const loginWorkflow = workflow(function* () {
  const creds = yield* query("credentials").as<{
    email: string;
    password: string;
  }>();

  const user = yield* activity("authenticate", async () => {
    // Simulate API call
    await new Promise((r) => setTimeout(r, 500));
    return { name: creds.email.split("@")[0], email: creds.email };
  });

  return user;
});

const sessionWorkflow = workflow(function* () {
  // Block until login completes — the registry resolves this automatically
  const user = yield* query("login").as<User>();

  yield* publish(user);

  // Keep session alive until logout
  yield* handler()
    .on("logout", function* (_payload: undefined, done) {
      yield* activity("clear-session", async () => {
        // Clear server-side session, revoke tokens, etc.
      });
      yield* done(undefined);
    })
    .as<void>();
});

export const authRegistry = createRegistry()
  .add("login", loginWorkflow)
  .add("session", sessionWorkflow);
```

Key points:

- **`query("login").as<User>()`** inside `sessionWorkflow` creates a cross-workflow dependency. When both workflows are in the same registry, the interpreter automatically waits for `login` to complete and feeds its result into `session`.
- **`createRegistry()`** without arguments defaults to `MemoryStorage`. We'll pass `LocalStorage` at the app level.
- The module exports a `RegistryBuilder`, not a built `Registry` — we'll merge it later.

## Step 2: The Shop Module

```ts
// src/shop.ts
import { workflow, query, publish, handler, activity } from "cursus";
import { createRegistry } from "cursus";
import type { User } from "./auth";

export type CartItem = { id: string; name: string; price: number };

const cartWorkflow = workflow(function* () {
  let items: CartItem[] = [];

  // Wait for the first item
  const first = yield* query("add-item").as<CartItem>();
  items = [first];
  yield* publish(items);

  // Handle cart mutations
  const finalItems = yield* handler()
    .on("add-item", function* (item: CartItem) {
      items = [...items, item];
      yield* publish(items);
    })
    .on("remove-item", function* (id: string) {
      items = items.filter((i) => i.id !== id);
      yield* publish(items);
    })
    .on("checkout", function* (_payload: undefined, done) {
      yield* done(items);
    })
    .as<CartItem[]>();

  return finalItems;
});

export type OrderConfirmation = {
  orderId: string;
  customer: string;
  items: CartItem[];
  total: number;
};

const checkoutWorkflow = workflow(function* () {
  // These two queries resolve from other workflows in the registry
  const session = yield* query("session").as<User>();
  const cartItems = yield* query("cart").as<CartItem[]>();

  const order = yield* activity("place-order", async () => {
    await new Promise((r) => setTimeout(r, 1000));
    return {
      orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
      customer: session.name,
      items: cartItems,
      total: cartItems.reduce((sum, i) => sum + i.price, 0),
    } satisfies OrderConfirmation;
  });

  return order;
});

export const shopRegistry = createRegistry()
  .add("cart", cartWorkflow)
  .add("checkout", checkoutWorkflow);
```

Notice that `checkoutWorkflow` queries `"session"` — a workflow that lives in the auth module. This dependency is satisfied after we merge the registries.

## Step 3: Merge and Build

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LocalStorage, createRegistry } from "cursus";
import { createBindings } from "cursus/react";
import { authRegistry } from "./auth";
import { shopRegistry } from "./shop";
import { App } from "./App";

// Merge modules into a single registry with persistent storage.
// The storage passed to createRegistry becomes the default for all workflows.
const appRegistry = createRegistry(new LocalStorage("shop"))
  .merge(authRegistry)
  .merge(shopRegistry)
  .build();

export const { useWorkflow, usePublished, Provider } =
  createBindings(appRegistry);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider>
      <App />
    </Provider>
  </StrictMode>,
);
```

`merge` combines two registry builders. The compiler checks that overlapping keys have compatible result types — if `authRegistry` and `shopRegistry` both defined `"cart"` with different return types, you'd get a type error.

`createBindings` returns pre-typed hooks locked to the registry's types. The `useWorkflow` it returns knows that `"login"` returns `User`, `"cart"` returns `CartItem[]`, etc.

## Step 4: Build the UI

### Login

```tsx
// src/Login.tsx
import { useState } from "react";
import { useWorkflow } from "./main";

export function Login() {
  const { state, signal } = useWorkflow("login");
  const [email, setEmail] = useState("");

  if (state.status === "completed") {
    return <p>Logged in as {state.result.name}</p>;
  }

  if (state.status === "running") {
    return <p>Authenticating...</p>;
  }

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      signal("credentials", { email, password: "secret" });
    }}>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <button type="submit">Log In</button>
    </form>
  );
}
```

### Cart with `usePublished`

Here's where `usePublished` shines. Instead of re-rendering on every workflow state change, the cart total only re-renders when the actual total changes:

```tsx
// src/CartTotal.tsx
import { usePublished } from "./main";
import type { CartItem } from "./shop";

export function CartTotal() {
  const total = usePublished("cart", (items) => {
    if (!items) return 0;
    return (items as CartItem[]).reduce((sum, i) => sum + i.price, 0);
  });

  return <p>Total: ${total?.toFixed(2) ?? "0.00"}</p>;
}
```

`usePublished` subscribes to the cart workflow's published state and runs the selector. If the user adds an item with the same price as one they removed, the total doesn't change, so `CartTotal` doesn't re-render. This follows the same reference-equality convention as Redux's `useSelector`.

### Cart Item List

```tsx
// src/Cart.tsx
import { useWorkflow } from "./main";
import type { CartItem } from "./shop";

export function Cart() {
  const { published, signal } = useWorkflow("cart");
  const items = (published as CartItem[] | undefined) ?? [];

  return (
    <div>
      <h2>Cart ({items.length})</h2>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.name} — ${item.price.toFixed(2)}
            <button onClick={() => signal("remove-item", item.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {items.length > 0 && (
        <button onClick={() => signal("checkout", undefined)}>
          Checkout
        </button>
      )}
    </div>
  );
}
```

### Product Catalog

```tsx
// src/Products.tsx
import { useWorkflow } from "./main";
import type { CartItem } from "./shop";

const catalog: CartItem[] = [
  { id: "widget", name: "Widget", price: 9.99 },
  { id: "gadget", name: "Gadget", price: 24.99 },
  { id: "doohickey", name: "Doohickey", price: 14.99 },
];

export function Products() {
  const { signal } = useWorkflow("cart");

  return (
    <div>
      <h2>Products</h2>
      {catalog.map((item) => (
        <div key={item.id}>
          <span>{item.name} — ${item.price.toFixed(2)}</span>
          <button onClick={() => signal("add-item", item)}>
            Add to Cart
          </button>
        </div>
      ))}
    </div>
  );
}
```

### Checkout Status

```tsx
// src/Checkout.tsx
import { useWorkflow } from "./main";

export function Checkout() {
  const { state } = useWorkflow("checkout");

  if (state.status === "running") {
    return <p>Placing order...</p>;
  }

  if (state.status === "completed") {
    return (
      <div>
        <h2>Order Confirmed</h2>
        <p>Order ID: {state.result.orderId}</p>
        <p>Customer: {state.result.customer}</p>
        <p>Items: {state.result.items.length}</p>
        <p>Total: ${state.result.total.toFixed(2)}</p>
      </div>
    );
  }

  return null;
}
```

### Putting It Together

```tsx
// src/App.tsx
import { useWorkflow } from "./main";
import { Login } from "./Login";
import { Products } from "./Products";
import { Cart } from "./Cart";
import { CartTotal } from "./CartTotal";
import { Checkout } from "./Checkout";

export function App() {
  const { state: loginState } = useWorkflow("login");
  const { state: checkoutState } = useWorkflow("checkout");

  return (
    <div>
      <h1>Shop</h1>
      <Login />

      {loginState.status === "completed" && checkoutState.status !== "completed" && (
        <div>
          <Products />
          <Cart />
          <CartTotal />
        </div>
      )}

      <Checkout />
    </div>
  );
}
```

## How the Dependencies Resolve

When the app loads:

1. `useWorkflow("login")` starts the login workflow → it blocks at `query("credentials")` → status is `"waiting"`
2. `useWorkflow("checkout")` starts the checkout workflow → it blocks at `query("session")` → the registry auto-starts `session` → which blocks at `query("login")` → waiting for login to complete

When the user logs in:

3. `signal("credentials", ...)` → login's `activity("authenticate")` runs → login completes with `User`
4. Session's `query("login")` resolves → session calls `publish(user)` → session enters its handler loop
5. Checkout is still blocked on `query("cart")` — waiting for the cart workflow to complete

When the user adds items and clicks checkout:

6. `signal("checkout", undefined)` → cart's handler calls `done(items)` → cart completes with `CartItem[]`
7. Checkout's `query("cart")` resolves → `activity("place-order")` runs → checkout completes

The registry handles all of this coordination. You never manually pass data between workflows.

## Circular Dependency Detection

What if `session` queried `"checkout"` and `checkout` queried `"session"`? The registry detects cycles immediately:

```
Error: Circular dependency detected: checkout -> session -> checkout
```

This check happens when the dependency edge is added, not at runtime — you get a clear error with the full cycle path.

## What's Next

- [Layers](../layers.md) — an alternative to registries for simpler cross-workflow setups
- [Testing](../testing.md) — test individual workflows in isolation with `createTestRuntime`
- [SSR](../ssr.md) — run workflows on the server and hydrate on the client
- [API Reference](../api-reference.md) — full reference for `createRegistry`, `merge`, `usePublished`, and more

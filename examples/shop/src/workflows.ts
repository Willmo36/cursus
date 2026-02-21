// ABOUTME: Workflow definitions for the shop example.
// ABOUTME: Catalog fetches products, cart manages items via signals, checkout coordinates login and cart.
import type { WorkflowFunction } from "react-workflow";
import {
	type ApiFetch,
	addToCart,
	fetchProducts,
	login,
	removeFromCart,
} from "./api";
import type { CartItem, Order, Product } from "./types";

// --- Catalog workflow ---

type CatalogSignals = Record<string, never>;

export function createCatalogWorkflow(
	apiFetch: ApiFetch,
): WorkflowFunction<Product[], CatalogSignals> {
	return function* (ctx) {
		const products = yield* ctx.activity("fetch-products", (signal) =>
			fetchProducts(apiFetch, signal),
		);
		return products;
	};
}

// --- Cart workflow ---

type CartSignals = {
	add: string;
	remove: string;
	checkout: undefined;
};

export function createCartWorkflow(
	apiFetch: ApiFetch,
): WorkflowFunction<
	CartItem[],
	CartSignals,
	Record<string, never>,
	{ items: CartItem[] }
> {
	return function* (ctx) {
		let items: CartItem[] = [];
		ctx.query("items", () => items);

		const res =  yield* ctx.on<CartItem[]>({
			add: function* (ctx, productId: string) {
				items = yield* ctx.activity("add-to-cart", (signal) =>
					addToCart(apiFetch, productId, signal),
				);
			},
			remove: function* (ctx, productId: string) {
				items = yield* ctx.activity("remove-from-cart", (signal) =>
					removeFromCart(apiFetch, productId, signal),
				);
			},
			checkout: function* (ctx) {
				yield* ctx.done(items);
			},
		});
		return res;
	};
}

// --- Checkout workflow ---

type CheckoutSignals = {
	login: { email: string; password: string };
};

type CheckoutWorkflowMap = {
	cart: CartItem[];
};

export function createCheckoutWorkflow(
	apiFetch: ApiFetch,
): WorkflowFunction<Order, CheckoutSignals, CheckoutWorkflowMap> {
	return function* (ctx) {
		const [credentials, items] = yield* ctx.waitForAll(
			"login",
			ctx.workflow("cart"),
		);

		const user = yield* ctx.activity("authenticate", (signal) =>
			login(apiFetch, credentials.email, credentials.password, signal),
		);

		const order = yield* ctx.activity("place-order", async () => {
			const total = items.reduce(
				(sum, item) => sum + item.price * item.quantity,
				0,
			);
			return {
				orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
				user,
				items,
				total,
			};
		});

		return order;
	};
}

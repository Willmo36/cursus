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
		const products = yield* ctx.activity("fetch-products", () =>
			fetchProducts(apiFetch),
		);
		return products;
	};
}

// --- Cart workflow ---

type CartAction =
	| { type: "add"; productId: string }
	| { type: "remove"; productId: string }
	| { type: "checkout" };

type CartSignals = {
	action: CartAction;
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

		for (;;) {
			const action = yield* ctx.waitFor("action");

			if (action.type === "checkout") {
				return items;
			}

			if (action.type === "add") {
				items = yield* ctx.activity("add-to-cart", () =>
					addToCart(apiFetch, action.productId),
				);
			}

			if (action.type === "remove") {
				items = yield* ctx.activity("remove-from-cart", () =>
					removeFromCart(apiFetch, action.productId),
				);
			}
		}
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
		const [credentials, items] = yield* ctx.waitAll(
			"login",
			ctx.workflow("cart"),
		);

		const user = yield* ctx.activity("authenticate", () =>
			login(apiFetch, credentials.email, credentials.password),
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

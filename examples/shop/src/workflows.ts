// ABOUTME: Workflow definitions for the shop example.
// ABOUTME: Catalog fetches products, cart manages items via signals, checkout coordinates login and cart.
import { activity, all, join, publish, receive, workflow } from "cursus";
import {
	type ApiFetch,
	addToCart,
	fetchProducts,
	login,
	removeFromCart,
} from "./api";
import type { CartItem, Order, Product } from "./types";

// --- Catalog workflow ---

export function createCatalogWorkflow(apiFetch: ApiFetch) {
	return workflow(function* () {
		const products = yield* activity("fetch-products", (signal) =>
			fetchProducts(apiFetch, signal),
		);
		return products;
	});
}

// --- Cart workflow ---

type CartSignals = {
	add: string;
	remove: string;
	checkout: undefined;
};

export function createCartWorkflow(apiFetch: ApiFetch) {
	return workflow(function* () {
		let items: CartItem[] = [];

		const res = yield* receive<CartItem[]>({
			add: function* (payload) {
				const productId = payload as string;
				items = yield* activity("add-to-cart", (signal) =>
					addToCart(apiFetch, productId, signal),
				);
				yield* publish(items);
			},
			remove: function* (payload) {
				const productId = payload as string;
				items = yield* activity("remove-from-cart", (signal) =>
					removeFromCart(apiFetch, productId, signal),
				);
				yield* publish(items);
			},
			checkout: function* (_payload, done) {
				yield* done(items);
			},
		});
		return res;
	});
}

// --- Checkout workflow ---

type CheckoutSignals = {
	login: { email: string; password: string };
};

export function createCheckoutWorkflow(apiFetch: ApiFetch) {
	return workflow(function* () {
		const [credentials, items] = yield* all(
			receive("login").as<{ email: string; password: string }>(),
			join("cart").as<CartItem[]>(),
		);

		const user = yield* activity("authenticate", (signal) =>
			login(apiFetch, credentials.email, credentials.password, signal),
		);

		const order = yield* activity("place-order", async () => {
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
	});
}

// ABOUTME: Typed fetch wrapper for shop API calls.
// ABOUTME: Injects x-force-error header when error simulation is enabled.
import type { CartItem, Product, User } from "./types";

export type ApiFetch = (
	url: string,
	options?: RequestInit,
) => Promise<Response>;

export function createApiFetch(shouldForceError: () => boolean): ApiFetch {
	return (url: string, options?: RequestInit) => {
		const headers = new Headers(options?.headers);
		if (shouldForceError()) {
			headers.set("x-force-error", "true");
		}
		return fetch(url, { ...options, headers });
	};
}

async function parseOrThrow<T>(response: Response): Promise<T> {
	const data = await response.json();
	if (!response.ok) {
		throw new Error(data.error ?? `HTTP ${response.status}`);
	}
	return data as T;
}

export async function fetchProducts(apiFetch: ApiFetch): Promise<Product[]> {
	const res = await apiFetch("/api/products");
	return parseOrThrow<Product[]>(res);
}

export async function addToCart(
	apiFetch: ApiFetch,
	productId: string,
): Promise<CartItem[]> {
	const res = await apiFetch("/api/cart/add", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ productId }),
	});
	return parseOrThrow<CartItem[]>(res);
}

export async function removeFromCart(
	apiFetch: ApiFetch,
	productId: string,
): Promise<CartItem[]> {
	const res = await apiFetch("/api/cart/remove", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ productId }),
	});
	return parseOrThrow<CartItem[]>(res);
}

export async function login(
	apiFetch: ApiFetch,
	email: string,
	password: string,
): Promise<User> {
	const res = await apiFetch("/api/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
	return parseOrThrow<User>(res);
}

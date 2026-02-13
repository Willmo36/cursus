// ABOUTME: Shared type definitions for the shop example.
// ABOUTME: Defines Product, CartItem, User, and Order types.

export type Product = {
	id: string;
	name: string;
	price: number;
	image: string;
	description: string;
};

export type CartItem = {
	productId: string;
	name: string;
	price: number;
	quantity: number;
};

export type User = {
	id: string;
	email: string;
	name: string;
};

export type Order = {
	orderId: string;
	user: User;
	items: CartItem[];
	total: number;
};

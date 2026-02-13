// ABOUTME: Vite configuration with embedded API middleware for the shop example.
// ABOUTME: Serves product, cart, and login endpoints directly from the dev server.
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

type Product = {
	id: string;
	name: string;
	price: number;
	image: string;
	description: string;
};

type CartItem = {
	productId: string;
	name: string;
	price: number;
	quantity: number;
};

const PRODUCTS: Product[] = [
	{
		id: "p1",
		name: "Wireless Headphones",
		price: 79.99,
		image: "https://picsum.photos/seed/headphones/200",
		description: "Premium noise-cancelling wireless headphones",
	},
	{
		id: "p2",
		name: "Mechanical Keyboard",
		price: 129.99,
		image: "https://picsum.photos/seed/keyboard/200",
		description: "Cherry MX switches with RGB backlighting",
	},
	{
		id: "p3",
		name: "USB-C Hub",
		price: 49.99,
		image: "https://picsum.photos/seed/usbhub/200",
		description: "7-in-1 hub with HDMI, USB-A, and SD card reader",
	},
	{
		id: "p4",
		name: "Webcam HD",
		price: 59.99,
		image: "https://picsum.photos/seed/webcam/200",
		description: "1080p webcam with built-in microphone",
	},
	{
		id: "p5",
		name: "Monitor Stand",
		price: 34.99,
		image: "https://picsum.photos/seed/stand/200",
		description: "Adjustable aluminum monitor riser",
	},
	{
		id: "p6",
		name: "Mouse Pad XL",
		price: 19.99,
		image: "https://picsum.photos/seed/mousepad/200",
		description: "Extended desk mat with stitched edges",
	},
];

function shopApi(): Plugin {
	let cart: CartItem[] = [];

	return {
		name: "shop-api",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (!req.url?.startsWith("/api/")) return next();

				const forceError = req.headers["x-force-error"] === "true";

				res.setHeader("Content-Type", "application/json");

				if (forceError) {
					res.statusCode = 500;
					res.end(
						JSON.stringify({ error: "Forced server error (toggle is on)" }),
					);
					return;
				}

				if (req.url === "/api/products" && req.method === "GET") {
					res.end(JSON.stringify(PRODUCTS));
					return;
				}

				if (req.url === "/api/cart" && req.method === "GET") {
					res.end(JSON.stringify(cart));
					return;
				}

				if (req.url === "/api/cart/add" && req.method === "POST") {
					let body = "";
					req.on("data", (chunk) => (body += chunk));
					req.on("end", () => {
						const { productId } = JSON.parse(body);
						const product = PRODUCTS.find((p) => p.id === productId);
						if (!product) {
							res.statusCode = 404;
							res.end(JSON.stringify({ error: "Product not found" }));
							return;
						}
						const existing = cart.find((i) => i.productId === productId);
						if (existing) {
							existing.quantity++;
						} else {
							cart.push({
								productId: product.id,
								name: product.name,
								price: product.price,
								quantity: 1,
							});
						}
						res.end(JSON.stringify(cart));
					});
					return;
				}

				if (req.url === "/api/cart/remove" && req.method === "POST") {
					let body = "";
					req.on("data", (chunk) => (body += chunk));
					req.on("end", () => {
						const { productId } = JSON.parse(body);
						cart = cart.filter((i) => i.productId !== productId);
						res.end(JSON.stringify(cart));
					});
					return;
				}

				if (req.url === "/api/login" && req.method === "POST") {
					let body = "";
					req.on("data", (chunk) => (body += chunk));
					req.on("end", () => {
						const { email, password } = JSON.parse(body);
						if (
							email === "user@shop.com" &&
							password === "password123"
						) {
							res.end(
								JSON.stringify({
									id: "u1",
									email: "user@shop.com",
									name: "Shop User",
								}),
							);
						} else {
							res.statusCode = 401;
							res.end(JSON.stringify({ error: "Invalid credentials" }));
						}
					});
					return;
				}

				res.statusCode = 404;
				res.end(JSON.stringify({ error: "Not found" }));
			});
		},
	};
}

export default defineConfig({
	plugins: [react(), tailwindcss(), shopApi()],
});

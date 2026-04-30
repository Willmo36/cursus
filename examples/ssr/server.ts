// ABOUTME: Node.js HTTP server that runs a workflow via a registry and serves server-rendered HTML.
// ABOUTME: Demonstrates real SSR — product data is in the initial HTML response.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { createRegistry, MemoryStorage } from "cursus";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ProductPage } from "./src/ProductPage";
import type { Product } from "./src/workflow";
import { productWorkflow } from "./src/workflow";

const PORT = 3000;
const DIST_DIR = join(import.meta.dirname, "dist");

// Read the Vite manifest to find the hashed client bundle filename
const manifest = JSON.parse(
	readFileSync(join(DIST_DIR, ".vite/manifest.json"), "utf-8"),
);
const clientEntry = manifest["src/client.tsx"];
const clientScript = clientEntry?.file ?? "assets/client.js";

const server = createServer(async (req, res) => {
	// Serve static assets from dist/
	if (req.url?.startsWith("/assets/")) {
		const filePath = join(DIST_DIR, req.url);
		try {
			const content = readFileSync(filePath);
			const ext = filePath.split(".").pop();
			const contentType =
				ext === "js"
					? "application/javascript"
					: ext === "css"
						? "text/css"
						: "application/octet-stream";
			res.writeHead(200, { "Content-Type": contentType });
			res.end(content);
		} catch {
			res.writeHead(404);
			res.end("Not found");
		}
		return;
	}

	// For all other routes, run the workflow via a registry and serve SSR HTML
	try {
		const storage = new MemoryStorage();
		const registry = createRegistry(storage)
			.add("product", productWorkflow)
			.build();

		// Start the workflow and wait for it to settle (complete or block on receive)
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
				if (!resolved) {
					resolved = true;
					resolve();
				}
			});
		});

		const state = registry.getState("product") ?? { status: "running" as const };
		const events = registry.getEvents("product");
		const interpreter = registry._registry.getInterpreter("product");
		const published = interpreter?.published as Product | undefined;

		// Snapshot for client hydration: seed events into client storage before mount
		const snapshot = { workflowId: "product", events, state, published };

		const html = renderToString(
			createElement(ProductPage, {
				snapshot,
				product: published,
				state,
			}),
		);

		res.writeHead(200, { "Content-Type": "text/html" });
		res.end(`<!doctype html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title>SSR Example</title>
</head>
<body>
	<div id="root">${html}</div>
	<script>window.__SNAPSHOT__ = ${JSON.stringify(snapshot)}</script>
	<script type="module" src="/${clientScript}"></script>
</body>
</html>`);
	} catch (err) {
		console.error("SSR error:", err);
		res.writeHead(500);
		res.end("Internal server error");
	}
});

server.listen(PORT, () => {
	console.log(`SSR server listening on http://localhost:${PORT}`);
});

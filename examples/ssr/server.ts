// ABOUTME: Node.js HTTP server that runs a workflow and serves server-rendered HTML.
// ABOUTME: Demonstrates real SSR — product data is in the initial HTML response.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { runWorkflow } from "cursus";
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

	// For all other routes, run the workflow and serve SSR HTML
	try {
		const snapshot = await runWorkflow("product", productWorkflow);

		const product = snapshot.published as Product | undefined;
		const html = renderToString(
			createElement(ProductPage, {
				snapshot,
				product,
				state: snapshot.state,
				receiving: snapshot.receiving,
				result: undefined,
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

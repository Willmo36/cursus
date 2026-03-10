// ABOUTME: Entry point that simulates SSR by running the workflow before React mounts.
// ABOUTME: In production, runWorkflow() would execute on the server and the snapshot would be serialized.

import { runWorkflow } from "cursus";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { productWorkflow } from "./workflow";

// Simulate SSR: run the workflow before mounting React.
// In a real app, this would happen on the server (e.g., in a Next.js RSC or Remix loader)
// and the snapshot would be passed to the client via props, script tag, or loader data.
async function main() {
	const snapshot = await runWorkflow("product", productWorkflow);

	// The snapshot is JSON-serializable — this is where you'd transport it to the client
	console.log(
		"Server snapshot:",
		snapshot.state,
		snapshot.events.length,
		"events",
	);

	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<App snapshot={snapshot} />
		</StrictMode>,
	);
}

main();

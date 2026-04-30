// ABOUTME: Client entry point that hydrates server-rendered HTML.
// ABOUTME: Seeds server events into storage before mounting so the registry replays correctly.

import { createRegistry, LocalStorage } from "cursus";
import type { WorkflowSnapshot } from "cursus";
import { createBindings } from "cursus/react";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

import { App } from "./App";
import { productWorkflow } from "./workflow";

declare global {
	interface Window {
		__SNAPSHOT__: WorkflowSnapshot;
	}
}

const snapshot = window.__SNAPSHOT__;

// Seed server-side events into localStorage so the registry replays without re-running activities
const storage = new LocalStorage("ssr");
await storage.append(snapshot.workflowId, snapshot.events);

const registry = createRegistry(storage)
	.add("product", productWorkflow)
	.build();

const { Provider } = createBindings(registry);

const root = document.getElementById("root");
if (root) {
	hydrateRoot(
		root,
		<StrictMode>
			<Provider>
				<App snapshot={snapshot} />
			</Provider>
		</StrictMode>,
	);
}

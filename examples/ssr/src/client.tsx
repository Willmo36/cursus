// ABOUTME: Client entry point that hydrates server-rendered HTML.
// ABOUTME: Reads the workflow snapshot injected by the server and calls hydrateRoot().

import type { WorkflowSnapshot } from "cursus";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

import { App } from "./App";

declare global {
	interface Window {
		__SNAPSHOT__: WorkflowSnapshot;
	}
}

const snapshot = window.__SNAPSHOT__;

const root = document.getElementById("root");
if (root) {
	hydrateRoot(
		root,
		<StrictMode>
			<App snapshot={snapshot} />
		</StrictMode>,
	);
}

// ABOUTME: Entry point for the subscribe example app.
// ABOUTME: Builds a typed registry and creates React bindings for account and points workflows.

import { createRegistry } from "cursus";
import { createBindings } from "cursus/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { storage } from "./storage";
import { accountWorkflow, pointsWorkflow } from "./workflows";

const registry = createRegistry(storage)
	.add("account", accountWorkflow)
	.add("points", pointsWorkflow)
	.build();

export const { useWorkflow, Provider } = createBindings(registry);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Provider>
			<App />
		</Provider>
	</StrictMode>,
);

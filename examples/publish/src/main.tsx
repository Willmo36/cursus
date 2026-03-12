// ABOUTME: Entry point for the publish example app.
// ABOUTME: Builds a typed registry and creates React bindings for session and checkout workflows.

import { createRegistry } from "cursus";
import { createBindings } from "cursus/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { storage } from "./storage";
import { checkoutWorkflow, sessionWorkflow } from "./workflows";

const registry = createRegistry(storage)
	.add("session", sessionWorkflow)
	.add("checkout", checkoutWorkflow)
	.build();

export const { useWorkflow, Provider } = createBindings(registry);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Provider>
			<App />
		</Provider>
	</StrictMode>,
);

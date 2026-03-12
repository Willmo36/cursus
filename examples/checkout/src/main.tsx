// ABOUTME: Entry point for the checkout example app.
// ABOUTME: Builds a typed registry and creates React bindings for the profile workflow.

import { createRegistry } from "cursus";
import { createBindings } from "cursus/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { storage } from "./storage";
import { profileWorkflow } from "./workflows";

const registry = createRegistry(storage)
	.add("profile", profileWorkflow)
	.build();

export const { useWorkflow, Provider } = createBindings(registry);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Provider>
			<App />
		</Provider>
	</StrictMode>,
);

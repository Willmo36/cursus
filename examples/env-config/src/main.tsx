// ABOUTME: Entry point for the env-config example app.
// ABOUTME: Creates a workflow registry with the env workflow and exports typed bindings.

import { createRegistry } from "cursus";
import { createBindings } from "cursus/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { storage } from "./storage";
import { envWorkflow } from "./workflows";

const registry = createRegistry(storage).add("env", envWorkflow).build();

export const { useWorkflow, Provider } = createBindings(registry);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Provider>
			<App />
		</Provider>
	</StrictMode>,
);

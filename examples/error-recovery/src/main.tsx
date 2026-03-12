// ABOUTME: Entry point for the error recovery example.
// ABOUTME: Builds a typed registry and creates React bindings for the payment workflow.

import { createRegistry } from "cursus";
import { createBindings } from "cursus/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { storage } from "./storage";
import { paymentWorkflow } from "./workflows";

const registry = createRegistry(storage)
	.add("payment", paymentWorkflow)
	.build();

export const { useWorkflow, Provider } = createBindings(registry);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Provider>
			<App />
		</Provider>
	</StrictMode>,
);

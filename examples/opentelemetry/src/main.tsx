// ABOUTME: Entry point for the opentelemetry example app.
// ABOUTME: Sets up the workflow registry with OTel tracing and mounts the App component.
import { createRegistry } from "cursus";
import { createBindings } from "cursus/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { storage } from "./storage";
import { tracingObserver } from "./tracing";
import { checkoutWorkflow } from "./workflows";

const registry = createRegistry(storage)
	.add("checkout", checkoutWorkflow)
	.build({ onEvent: tracingObserver });

const { Provider } = createBindings(registry);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Provider>
			<App />
		</Provider>
	</StrictMode>,
);

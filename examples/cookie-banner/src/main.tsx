// ABOUTME: Entry point for the cookie banner example app.
// ABOUTME: Sets up the workflow registry and mounts the App component.
import { createRegistry, LocalStorage } from "cursus";
import { createBindings } from "cursus/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { cookieWorkflow } from "./workflow";

const registry = createRegistry(new LocalStorage())
	.add("cookies", cookieWorkflow)
	.build();

const { Provider } = createBindings(registry);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Provider>
			<App />
		</Provider>
	</StrictMode>,
);

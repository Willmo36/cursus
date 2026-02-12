// ABOUTME: Entry point for the checkout example app.
// ABOUTME: Wraps the app in WorkflowRegistryProvider with the profile workflow registered globally.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkflowRegistryProvider } from "react-workflow";
import { App } from "./App";
import { storage } from "./storage";
import { profileWorkflow } from "./workflows";

const workflows = {
	profile: profileWorkflow,
};

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<WorkflowRegistryProvider workflows={workflows} storage={storage}>
			<App />
		</WorkflowRegistryProvider>
	</StrictMode>,
);

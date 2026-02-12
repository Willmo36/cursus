// ABOUTME: Entry point for the checkout example app.
// ABOUTME: Wraps the app in WorkflowRegistryProvider with the profile workflow registered globally.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { WorkflowFunction } from "react-workflow";
import { LocalStorage, WorkflowRegistryProvider } from "react-workflow";
import { App } from "./App";
import { profileWorkflow } from "./workflows";

const storage = new LocalStorage();
const workflows = {
	profile: profileWorkflow as WorkflowFunction<unknown>,
};

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<WorkflowRegistryProvider workflows={workflows} storage={storage}>
			<App />
		</WorkflowRegistryProvider>
	</StrictMode>,
);

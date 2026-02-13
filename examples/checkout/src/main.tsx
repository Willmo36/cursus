// ABOUTME: Entry point for the checkout example app.
// ABOUTME: Wraps the app in WorkflowLayerProvider with the profile workflow registered.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLayer, WorkflowLayerProvider } from "react-workflow";
import { App } from "./App";
import { storage } from "./storage";
import { profileWorkflow } from "./workflows";

const layer = createLayer({ profile: profileWorkflow }, storage);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<WorkflowLayerProvider layer={layer}>
			<App />
		</WorkflowLayerProvider>
	</StrictMode>,
);

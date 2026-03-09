// ABOUTME: Entry point for the env-config example app.
// ABOUTME: Creates a workflow layer with the env workflow and mounts the app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createLayer } from "cursus";
import { WorkflowLayerProvider } from "cursus/react";
import { App } from "./App";
import { storage } from "./storage";
import { envWorkflow } from "./workflows";

const layer = createLayer({ env: envWorkflow }, storage);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<WorkflowLayerProvider layer={layer}>
			<App />
		</WorkflowLayerProvider>
	</StrictMode>,
);

// ABOUTME: Entry point for the error recovery example.
// ABOUTME: Registers the payment workflow in a layer so the order workflow can depend on it.

import { createLayer } from "cursus";
import { WorkflowLayerProvider } from "cursus/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { storage } from "./storage";
import { paymentWorkflow } from "./workflows";

const layer = createLayer({ payment: paymentWorkflow }, storage);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<WorkflowLayerProvider layer={layer}>
			<App />
		</WorkflowLayerProvider>
	</StrictMode>,
);

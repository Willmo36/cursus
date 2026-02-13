// ABOUTME: Entry point for the shop example app.
// ABOUTME: Sets up error toggle context, creates workflow layer, and mounts the app.
import "./index.css";
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { WorkflowLayerProvider, createLayer } from "react-workflow";
import { App } from "./App";
import { createApiFetch } from "./api";
import { ErrorToggleCtx } from "./error-toggle";
import { storage } from "./storage";
import { createCartWorkflow, createCheckoutWorkflow } from "./workflows";

function Root() {
	const [forceError, setForceError] = useState(false);
	const forceErrorRef = useRef(forceError);
	forceErrorRef.current = forceError;

	const apiFetch = useMemo(
		() => createApiFetch(() => forceErrorRef.current),
		[],
	);

	const layer = useMemo(
		() =>
			createLayer<{ cart: unknown; checkout: unknown }>(
				{
					cart: createCartWorkflow(apiFetch),
					checkout: createCheckoutWorkflow(apiFetch),
				},
				storage,
			),
		[apiFetch],
	);

	const errorToggle = useMemo(
		() => ({ forceError, setForceError, apiFetch }),
		[forceError, apiFetch],
	);

	return (
		<ErrorToggleCtx.Provider value={errorToggle}>
			<WorkflowLayerProvider layer={layer}>
				<App />
			</WorkflowLayerProvider>
		</ErrorToggleCtx.Provider>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Root />
	</StrictMode>,
);

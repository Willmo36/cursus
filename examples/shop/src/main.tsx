// ABOUTME: Entry point for the shop example app.
// ABOUTME: Sets up error toggle context, creates workflow registry, and mounts the app.
import "./index.css";
import { createRegistry } from "cursus";
import { createBindings } from "cursus/react";
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createApiFetch } from "./api";
import { ErrorToggleCtx } from "./error-toggle";
import { storage } from "./storage";
import { createCatalogWorkflow, createCartWorkflow, createCheckoutWorkflow } from "./workflows";

function Root() {
	const [forceError, setForceError] = useState(false);
	const forceErrorRef = useRef(forceError);
	forceErrorRef.current = forceError;

	const apiFetch = useMemo(
		() => createApiFetch(() => forceErrorRef.current),
		[],
	);

	const { Provider } = useMemo(() => {
		const registry = createRegistry(storage)
			.add("catalog", createCatalogWorkflow(apiFetch))
			.add("cart", createCartWorkflow(apiFetch))
			.add("checkout", createCheckoutWorkflow(apiFetch))
			.build();
		return createBindings(registry);
	}, [apiFetch]);

	const errorToggle = useMemo(
		() => ({ forceError, setForceError, apiFetch }),
		[forceError, apiFetch],
	);

	return (
		<ErrorToggleCtx.Provider value={errorToggle}>
			<Provider>
				<App />
			</Provider>
		</ErrorToggleCtx.Provider>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Root />
	</StrictMode>,
);

// ABOUTME: Entry point for the race example.
// ABOUTME: Renders the App component with React strict mode.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

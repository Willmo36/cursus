// ABOUTME: Entry point for the merge example app.
// ABOUTME: Renders the App component into the DOM root.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

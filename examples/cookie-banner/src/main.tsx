// ABOUTME: Entry point for the cookie banner example app.
// ABOUTME: Mounts the App component into the DOM root element.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

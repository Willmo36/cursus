// ABOUTME: Vite configuration for the subscribe example app.
// ABOUTME: Enables React Fast Refresh via the official plugin.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
});

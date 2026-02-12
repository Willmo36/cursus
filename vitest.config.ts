// ABOUTME: Test configuration for Vitest.
// ABOUTME: Uses jsdom for DOM simulation and React plugin for JSX support.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/test-setup.ts"],
	},
});

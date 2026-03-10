// ABOUTME: Vite configuration for building the client bundle.
// ABOUTME: Outputs a hashed JS bundle with manifest for the SSR server to reference.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	build: {
		manifest: true,
		rollupOptions: {
			input: "src/client.tsx",
		},
	},
});

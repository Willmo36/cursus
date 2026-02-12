// ABOUTME: Build configuration for the library using tsup.
// ABOUTME: Produces ESM and CJS outputs with TypeScript declarations.

import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	external: ["react", "react-dom"],
});

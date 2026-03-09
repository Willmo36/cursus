// ABOUTME: Build configuration for the library using tsup.
// ABOUTME: Produces ESM and CJS outputs with TypeScript declarations.

import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		react: "src/react.ts",
		devtools: "src/devtools.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	external: ["react", "react-dom"],
	define: {
		__LIBRARY_VERSION__: JSON.stringify(pkg.version),
	},
});

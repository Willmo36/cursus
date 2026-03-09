// ABOUTME: Version constants for workflow trace envelopes.
// ABOUTME: LIBRARY_VERSION is replaced at build time by tsup define.

declare const __LIBRARY_VERSION__: string;

export const EVENT_SCHEMA_VERSION = 2;

export const LIBRARY_VERSION: string =
	typeof __LIBRARY_VERSION__ !== "undefined"
		? __LIBRARY_VERSION__
		: "development";

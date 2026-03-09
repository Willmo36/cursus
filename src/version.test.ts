// ABOUTME: Tests for version constants used in workflow trace envelopes.
// ABOUTME: Validates EVENT_SCHEMA_VERSION and LIBRARY_VERSION exports.

import { describe, expect, it } from "vitest";
import { EVENT_SCHEMA_VERSION, LIBRARY_VERSION } from "./version";

describe("version constants", () => {
	it("EVENT_SCHEMA_VERSION is 1", () => {
		expect(EVENT_SCHEMA_VERSION).toBe(1);
	});

	it("LIBRARY_VERSION is a string", () => {
		expect(typeof LIBRARY_VERSION).toBe("string");
	});
});

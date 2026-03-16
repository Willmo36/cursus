// ABOUTME: Tests that the JSON Schema correctly validates WorkflowTrace envelopes.
// ABOUTME: Ensures schema covers all event types and rejects invalid data.

import Ajv from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import eventSchema from "./event-schema.json";
import { WorkflowRegistry } from "./registry";
import { MemoryStorage } from "./storage";
import { activity, workflow } from "./types";
import type { WorkflowEvent } from "./types";
import { EVENT_SCHEMA_VERSION, LIBRARY_VERSION } from "./version";

function createValidator() {
	const ajv = new Ajv();
	return ajv.compile(eventSchema);
}

describe("event schema", () => {
	it("validates a complete WorkflowTrace from a real workflow run", async () => {
		const greetWorkflow = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const storage = new MemoryStorage();
		const registry = new WorkflowRegistry({ greet: greetWorkflow }, storage);
		await registry.start("greet");

		const trace = registry.getTrace("greet");
		const validate = createValidator();
		const valid = validate(trace);
		expect(validate.errors).toBeNull();
		expect(valid).toBe(true);
	});

	it("rejects invalid event types", () => {
		const trace = {
			schemaVersion: 1,
			libraryVersion: "0.1.0",
			workflowId: "test",
			events: [{ type: "bogus_event", timestamp: 1 }],
		};

		const validate = createValidator();
		expect(validate(trace)).toBe(false);
	});

	it("rejects missing required fields", () => {
		const trace = {
			schemaVersion: 1,
			libraryVersion: "0.1.0",
			// missing workflowId
			events: [],
		};

		const validate = createValidator();
		expect(validate(trace)).toBe(false);
	});

	it("every event type in the TypeScript union has a schema definition", () => {
		const tsEventTypes: WorkflowEvent["type"][] = [
			"workflow_started",
			"workflow_completed",
			"workflow_failed",
			"workflow_cancelled",
			"activity_scheduled",
			"activity_completed",
			"activity_failed",
			"query_resolved",
			"timer_started",
			"timer_fired",
			"child_started",
			"child_completed",
			"child_failed",
			"all_started",
			"all_completed",
			"workflow_published",
			"race_started",
			"race_completed",
			"loop_started",
			"loop_completed",
		];

		const defs = (eventSchema as Record<string, unknown>).$defs as Record<
			string,
			Record<string, unknown>
		>;
		const schemaEventTypes = Object.values(defs).map(
			(def) =>
				(def.properties as Record<string, Record<string, unknown>>).type
					.const as string,
		);

		for (const eventType of tsEventTypes) {
			expect(schemaEventTypes).toContain(eventType);
		}
		expect(schemaEventTypes).toHaveLength(tsEventTypes.length);
	});
});

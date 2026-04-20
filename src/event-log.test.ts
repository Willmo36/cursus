// ABOUTME: Tests for the append-only event log.
// ABOUTME: Covers creation, appending, reading, sequence tracking, and event lookup.

import { describe, expect, it } from "vitest";
import { EventLog } from "./event-log";
import type { WorkflowEvent } from "./types";

describe("EventLog", () => {
	describe("onAppend observer", () => {
		it("calls onAppend for each appended event", () => {
			const observed: WorkflowEvent[] = [];
			const log = new EventLog([], (event) => observed.push(event));

			const e1: WorkflowEvent = {
				type: "workflow_started",
				timestamp: 1,
			};
			const e2: WorkflowEvent = {
				type: "workflow_completed",
				result: "done",
				timestamp: 2,
			};
			log.append(e1);
			log.append(e2);

			expect(observed).toEqual([e1, e2]);
		});

		it("does not call onAppend for initial events", () => {
			const observed: WorkflowEvent[] = [];
			const initial: WorkflowEvent[] = [
				{ type: "workflow_started", timestamp: 1 },
				{ type: "activity_scheduled", name: "fetch", seq: 1, timestamp: 2 },
			];
			const log = new EventLog(initial, (event) => observed.push(event));

			expect(observed).toEqual([]);

			const e: WorkflowEvent = {
				type: "workflow_completed",
				result: "ok",
				timestamp: 3,
			};
			log.append(e);
			expect(observed).toEqual([e]);
		});

		it("works without an onAppend callback", () => {
			const log = new EventLog();
			const event: WorkflowEvent = {
				type: "workflow_started",
				timestamp: 1,
			};
			log.append(event);
			expect(log.events()).toEqual([event]);
		});
	});

	it("starts empty", () => {
		const log = new EventLog();
		expect(log.events()).toEqual([]);
	});

	it("appends and reads events back", () => {
		const log = new EventLog();
		const event: WorkflowEvent = {
			type: "workflow_started",
			timestamp: Date.now(),
		};
		log.append(event);
		expect(log.events()).toEqual([event]);
	});

	it("appends multiple events in order", () => {
		const log = new EventLog();
		const e1: WorkflowEvent = {
			type: "activity_scheduled",
			name: "fetch",
			seq: 1,
			timestamp: 1,
		};
		const e2: WorkflowEvent = {
			type: "activity_completed",
			seq: 1,
			result: "ok",
			timestamp: 2,
		};
		log.append(e1);
		log.append(e2);
		expect(log.events()).toEqual([e1, e2]);
	});

	it("initializes from existing events", () => {
		const events: WorkflowEvent[] = [
			{ type: "workflow_started", timestamp: 1 },
			{ type: "activity_scheduled", name: "fetch", seq: 1, timestamp: 2 },
		];
		const log = new EventLog(events);
		expect(log.events()).toEqual(events);
	});

	it("finds a completed event by seq", () => {
		const log = new EventLog();
		log.append({
			type: "activity_scheduled",
			name: "fetch",
			seq: 1,
			timestamp: 1,
		});
		log.append({
			type: "activity_completed",
			seq: 1,
			result: "data",
			timestamp: 2,
		});
		log.append({
			type: "activity_scheduled",
			name: "save",
			seq: 2,
			timestamp: 3,
		});

		const found = log.findCompleted(1, "activity_completed");
		expect(found).toEqual({
			type: "activity_completed",
			seq: 1,
			result: "data",
			timestamp: 2,
		});
	});

	it("returns undefined when no matching completed event exists", () => {
		const log = new EventLog();
		log.append({
			type: "activity_scheduled",
			name: "fetch",
			seq: 1,
			timestamp: 1,
		});

		const found = log.findCompleted(1, "activity_completed");
		expect(found).toBeUndefined();
	});

	it("finds receive_resolved events by seq", () => {
		const log = new EventLog();
		log.append({
			type: "receive_resolved",
			label: "submit",
			value: { x: 1 },
			seq: 1,
			timestamp: 1,
		});

		const found = log.findCompleted(1, "receive_resolved");
		expect(found).toEqual({
			type: "receive_resolved",
			label: "submit",
			value: { x: 1 },
			seq: 1,
			timestamp: 1,
		});
	});

	it("finds timer_fired events by seq", () => {
		const log = new EventLog();
		log.append({
			type: "timer_started",
			seq: 1,
			durationMs: 1000,
			timestamp: 1,
		});
		log.append({ type: "timer_fired", seq: 1, timestamp: 2 });

		const found = log.findCompleted(1, "timer_fired");
		expect(found).toEqual({
			type: "timer_fired",
			seq: 1,
			timestamp: 2,
		});
	});

	it("finds child_completed events by seq", () => {
		const log = new EventLog();
		log.append({
			type: "child_started",
			name: "sub",
			workflowId: "parent/sub",
			seq: 1,
			timestamp: 1,
		});
		log.append({
			type: "child_completed",
			workflowId: "parent/sub",
			seq: 1,
			result: "done",
			timestamp: 2,
		});

		const found = log.findCompleted(1, "child_completed");
		expect(found).toEqual({
			type: "child_completed",
			workflowId: "parent/sub",
			seq: 1,
			result: "done",
			timestamp: 2,
		});
	});
});

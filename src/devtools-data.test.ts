// ABOUTME: Tests for the devtools data layer (buildTimelineData).
// ABOUTME: Covers span pairing, marker generation, tick computation, and edge cases.

import { describe, expect, it } from "vitest";
import { buildTimelineData } from "./devtools-data";
import type { WorkflowEvent, WorkflowEventLog } from "./types";

describe("buildTimelineData", () => {
	const base = 1000;

	function makeLog(id: string, events: WorkflowEvent[]): WorkflowEventLog {
		return { id, events };
	}

	it("produces spans from paired start/end events", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{
					type: "activity_scheduled",
					name: "fetch",
					seq: 0,
					timestamp: base + 100,
				},
				{
					type: "activity_completed",
					seq: 0,
					result: "ok",
					timestamp: base + 500,
				},
				{ type: "workflow_completed", result: "done", timestamp: base + 600 },
			]),
		];

		const result = buildTimelineData(logs);
		expect(result.rows).toHaveLength(1);

		const row = result.rows[0];
		expect(row.workflowId).toBe("wf1");

		// Should have one span: activity_scheduled → activity_completed
		expect(row.spans).toHaveLength(1);
		const span = row.spans[0];
		expect(span.startType).toBe("activity_scheduled");
		expect(span.endType).toBe("activity_completed");
		expect(span.name).toBe("fetch");
		expect(span.seq).toBe(0);

		// Positions should be relative (0-1 range based on global time range)
		// global range = 600ms, activity starts at +100, ends at +500
		expect(span.startPos).toBeCloseTo(100 / 600);
		expect(span.endPos).toBeCloseTo(500 / 600);
	});

	it("produces markers for point events", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{
					type: "receive_resolved",
					label: "submit",
					value: { x: 1 },
					seq: 0,
					timestamp: base + 300,
				},
				{ type: "workflow_completed", result: "done", timestamp: base + 600 },
			]),
		];

		const result = buildTimelineData(logs);
		const row = result.rows[0];

		// Point events: workflow_started, receive_resolved, workflow_completed
		expect(row.markers).toHaveLength(3);

		const query = row.markers.find((m) => m.type === "receive_resolved");
		expect(query).toBeDefined();
		expect(query?.pos).toBeCloseTo(300 / 600);
		expect(query?.label).toBe("submit");
	});

	it("handles multiple workflows with global time normalization", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{ type: "workflow_completed", result: "a", timestamp: base + 200 },
			]),
			makeLog("wf2", [
				{ type: "workflow_started", timestamp: base + 100 },
				{ type: "workflow_completed", result: "b", timestamp: base + 500 },
			]),
		];

		const result = buildTimelineData(logs);
		expect(result.rows).toHaveLength(2);

		// Global range: base to base+500 = 500ms
		// wf1 started at base → pos 0, completed at base+200 → pos 0.4
		// wf2 started at base+100 → pos 0.2, completed at base+500 → pos 1.0
		const wf1 = result.rows.find((r) => r.workflowId === "wf1");
		const wf2 = result.rows.find((r) => r.workflowId === "wf2");
		expect(wf1).toBeDefined();
		expect(wf2).toBeDefined();
		if (!wf1 || !wf2) return;

		expect(wf1.markers[0].pos).toBeCloseTo(0);
		expect(wf1.markers[1].pos).toBeCloseTo(0.4);
		expect(wf2.markers[0].pos).toBeCloseTo(0.2);
		expect(wf2.markers[1].pos).toBeCloseTo(1.0);
	});

	it("pairs timer_started with timer_fired as a span", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{
					type: "timer_started",
					seq: 0,
					durationMs: 1000,
					timestamp: base + 50,
				},
				{ type: "timer_fired", seq: 0, timestamp: base + 1050 },
				{
					type: "workflow_completed",
					result: "done",
					timestamp: base + 1100,
				},
			]),
		];

		const result = buildTimelineData(logs);
		const row = result.rows[0];

		expect(row.spans).toHaveLength(1);
		expect(row.spans[0].startType).toBe("timer_started");
		expect(row.spans[0].endType).toBe("timer_fired");
	});

	it("includes durationMs in result", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{ type: "workflow_completed", result: "done", timestamp: base + 2500 },
			]),
		];

		const result = buildTimelineData(logs);
		expect(result.durationMs).toBe(2500);
	});

	it("includes time axis ticks", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{ type: "workflow_completed", result: "done", timestamp: base + 3200 },
			]),
		];

		const result = buildTimelineData(logs);
		// 3200ms range → ticks at 0s, 1s, 2s, 3s
		expect(result.ticks).toBeDefined();
		expect(result.ticks.length).toBe(4);
		expect(result.ticks[0]).toEqual({ pos: 0, label: "0s" });
		expect(result.ticks[1].pos).toBeCloseTo(1000 / 3200);
		expect(result.ticks[1].label).toBe("1s");
		expect(result.ticks[2].pos).toBeCloseTo(2000 / 3200);
		expect(result.ticks[3].pos).toBeCloseTo(3000 / 3200);
	});

	it("includes durationMs on each span", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{
					type: "activity_scheduled",
					name: "fetch",
					seq: 0,
					timestamp: base + 100,
				},
				{
					type: "activity_completed",
					seq: 0,
					result: "ok",
					timestamp: base + 500,
				},
				{ type: "workflow_completed", result: "done", timestamp: base + 600 },
			]),
		];

		const result = buildTimelineData(logs);
		const span = result.rows[0].spans[0];
		expect(span.durationMs).toBe(400);
	});

	it("uses millisecond ticks for short durations", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [
				{ type: "workflow_started", timestamp: base },
				{ type: "workflow_completed", result: "done", timestamp: base + 80 },
			]),
		];

		const result = buildTimelineData(logs);
		// 80ms → ticks at 0ms, 20ms, 40ms, 60ms, 80ms (interval=20)
		expect(result.ticks[0].label).toBe("0ms");
		expect(result.ticks.length).toBeGreaterThanOrEqual(3);
	});

	it("returns empty rows for empty logs", () => {
		const result = buildTimelineData([]);
		expect(result.rows).toHaveLength(0);
	});

	it("handles single-event workflow without crashing", () => {
		const logs: WorkflowEventLog[] = [
			makeLog("wf1", [{ type: "workflow_started", timestamp: base }]),
		];

		const result = buildTimelineData(logs);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].markers).toHaveLength(1);
		expect(result.rows[0].markers[0].pos).toBe(0);
	});
});

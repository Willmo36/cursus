// ABOUTME: Framework-agnostic data layer for the devtools timeline.
// ABOUTME: Transforms workflow event logs into timeline spans, markers, and ticks.

import type { WorkflowEvent, WorkflowEventLog } from "./types";

// --- Timeline data types ---

export type TimelineSpan = {
	startType: string;
	endType: string;
	name: string;
	seq: number;
	startPos: number;
	endPos: number;
	durationMs: number;
	color: string;
	details: string;
};

export type TimelineMarker = {
	type: string;
	pos: number;
	label: string;
	color: string;
};

export type TimelineRow = {
	workflowId: string;
	spans: TimelineSpan[];
	markers: TimelineMarker[];
};

export type TimelineTick = {
	pos: number;
	label: string;
};

export type TimelineData = {
	rows: TimelineRow[];
	durationMs: number;
	ticks: TimelineTick[];
};

// --- Constants ---

const SPAN_PAIRS: Record<string, string> = {
	activity_scheduled: "activity_completed",
	timer_started: "timer_fired",
	child_started: "child_completed",
	all_started: "all_completed",
};

const SPAN_START_TYPES = new Set(Object.keys(SPAN_PAIRS));

// --- Helpers ---

function isSpanStart(type: string): boolean {
	return SPAN_START_TYPES.has(type);
}

function isSpanEnd(type: string): boolean {
	return (
		type === "activity_completed" ||
		type === "timer_fired" ||
		type === "child_completed" ||
		type === "all_completed"
	);
}

export function spanName(event: WorkflowEvent): string {
	if ("name" in event && typeof event.name === "string") return event.name;
	if (event.type === "timer_started") return `${event.durationMs}ms`;
	return event.type;
}

export function markerLabel(event: WorkflowEvent): string {
	if (event.type === "receive_resolved") return event.label;
	if (event.type === "ask_resolved") return event.label;
	if (event.type === "workflow_started") return "started";
	if (event.type === "workflow_completed") return "completed";
	if (event.type === "workflow_failed") return "failed";
	return event.type;
}

export function computeTicks(durationMs: number): TimelineTick[] {
	if (durationMs === 0) return [{ pos: 0, label: "0ms" }];

	// Choose a tick interval that gives roughly 4-8 ticks
	const useSeconds = durationMs >= 500;
	let interval: number;
	if (useSeconds) {
		const steps = [0.5, 1, 2, 5, 10, 30, 60];
		const target = durationMs / 5;
		interval =
			(steps.find((s) => s * 1000 >= target) ?? steps[steps.length - 1]) * 1000;
	} else {
		const steps = [1, 2, 5, 10, 20, 50, 100];
		const target = durationMs / 5;
		interval = steps.find((s) => s >= target) ?? steps[steps.length - 1];
	}

	const ticks: TimelineTick[] = [];
	for (let t = 0; t < durationMs; t += interval) {
		const pos = t / durationMs;
		const label = useSeconds ? `${t / 1000}s` : `${t}ms`;
		ticks.push({ pos, label });
	}

	return ticks;
}

export function buildTimelineData(logs: WorkflowEventLog[]): TimelineData {
	if (logs.length === 0) return { rows: [], durationMs: 0, ticks: [] };

	// Find global min/max timestamps
	let globalMin = Number.POSITIVE_INFINITY;
	let globalMax = Number.NEGATIVE_INFINITY;
	for (const log of logs) {
		for (const event of log.events) {
			if (event.timestamp < globalMin) globalMin = event.timestamp;
			if (event.timestamp > globalMax) globalMax = event.timestamp;
		}
	}

	const range = globalMax - globalMin;

	function toPos(timestamp: number): number {
		if (range === 0) return 0;
		return (timestamp - globalMin) / range;
	}

	const rows: TimelineRow[] = logs.map((log) => {
		const spans: TimelineSpan[] = [];
		const markers: TimelineMarker[] = [];

		// Index span-start events by seq for pairing
		const pendingStarts = new Map<number, WorkflowEvent>();

		for (const event of log.events) {
			if (isSpanStart(event.type) && "seq" in event) {
				pendingStarts.set(event.seq, event);
			} else if (isSpanEnd(event.type) && "seq" in event) {
				const startEvent = pendingStarts.get(event.seq);
				if (startEvent) {
					spans.push({
						startType: startEvent.type,
						endType: event.type,
						name: spanName(startEvent),
						seq: event.seq,
						startPos: toPos(startEvent.timestamp),
						endPos: toPos(event.timestamp),
						durationMs: event.timestamp - startEvent.timestamp,
						color: eventColor(startEvent.type),
						details: formatDetails(event),
					});
					pendingStarts.delete(event.seq);
				}
			} else {
				markers.push({
					type: event.type,
					pos: toPos(event.timestamp),
					label: markerLabel(event),
					color: eventColor(event.type),
				});
			}
		}

		return { workflowId: log.id, spans, markers };
	});

	return { rows, durationMs: range, ticks: computeTicks(range) };
}

export function formatDetails(event: WorkflowEvent): string {
	switch (event.type) {
		case "activity_scheduled":
			return event.name;
		case "activity_completed":
			return truncate(JSON.stringify(event.result));
		case "activity_failed":
			return event.error;
		case "receive_resolved":
			return `${event.label} = ${truncate(JSON.stringify(event.value))}`;
		case "ask_resolved":
			return `${event.label} (live)`;
		case "workflow_completed":
			return truncate(JSON.stringify(event.result));
		case "workflow_failed":
			return event.error;
		case "child_started":
			return event.name;
		case "child_completed":
			return truncate(JSON.stringify(event.result));
		case "child_failed":
			return event.error;
		case "timer_started":
			return `${event.durationMs}ms`;
		case "timer_fired":
			return "";
		case "all_completed":
			return truncate(JSON.stringify(event.results));
		default:
			return "";
	}
}

export function formatDuration(ms: number): string {
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function truncate(str: string, max = 60): string {
	return str.length > max ? `${str.slice(0, max)}...` : str;
}

export function eventColor(type: string): string {
	if (type.includes("completed")) return "#4ec9b0";
	if (type.includes("failed")) return "#f44747";
	if (type.includes("started") || type.includes("scheduled")) return "#dcdcaa";
	if (type.includes("signal")) return "#c586c0";
	return "#d4d4d4";
}

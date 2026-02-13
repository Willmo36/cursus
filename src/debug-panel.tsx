// ABOUTME: Reusable debug panel that shows live workflow event logs.
// ABOUTME: Reads events from the registry in realtime via useWorkflowEvents.

import { useState } from "react";
import type { WorkflowEvent } from "./types";
import {
	useWorkflowEvents,
	type WorkflowEventLog,
} from "./use-workflow-events";

// --- Timeline data transformation ---

export type TimelineSpan = {
	startType: string;
	endType: string;
	name: string;
	seq: number;
	startPos: number;
	endPos: number;
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

export type TimelineData = {
	rows: TimelineRow[];
};

const SPAN_PAIRS: Record<string, string> = {
	activity_scheduled: "activity_completed",
	timer_started: "timer_fired",
	child_started: "child_completed",
	wait_all_started: "wait_all_completed",
};

const SPAN_START_TYPES = new Set(Object.keys(SPAN_PAIRS));

function isSpanStart(type: string): boolean {
	return SPAN_START_TYPES.has(type);
}

function isSpanEnd(type: string): boolean {
	return (
		type === "activity_completed" ||
		type === "timer_fired" ||
		type === "child_completed" ||
		type === "wait_all_completed"
	);
}

function spanName(event: WorkflowEvent): string {
	if ("name" in event && typeof event.name === "string") return event.name;
	if (event.type === "timer_started") return `${event.durationMs}ms`;
	return event.type;
}

function markerLabel(event: WorkflowEvent): string {
	if (event.type === "signal_received") return event.signal;
	if (event.type === "workflow_started") return "started";
	if (event.type === "workflow_completed") return "completed";
	if (event.type === "workflow_failed") return "failed";
	return event.type;
}

export function buildTimelineData(logs: WorkflowEventLog[]): TimelineData {
	if (logs.length === 0) return { rows: [] };

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

	return { rows };
}

type WorkflowDebugPanelProps = {
	onClear?: () => void;
};

type ActiveTab = "events" | "timeline";

export function WorkflowDebugPanel({ onClear }: WorkflowDebugPanelProps) {
	const logs = useWorkflowEvents();
	const [open, setOpen] = useState(false);
	const [activeTab, setActiveTab] = useState<ActiveTab>("events");

	const totalEvents = logs.reduce((n, l) => n + l.events.length, 0);

	return (
		<div
			style={{
				position: "fixed",
				bottom: 0,
				left: 0,
				right: 0,
				background: "#1e1e1e",
				color: "#d4d4d4",
				fontFamily: "monospace",
				fontSize: 12,
				zIndex: 9999,
			}}
		>
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				style={{
					width: "100%",
					padding: "6px 12px",
					background: "#333",
					color: "#d4d4d4",
					border: "none",
					borderTop: "1px solid #555",
					cursor: "pointer",
					fontFamily: "monospace",
					fontSize: 12,
					textAlign: "left",
				}}
			>
				{open ? "Hide" : "Show"} Debug Panel
				{!open && (
					<span style={{ color: "#888", marginLeft: 8 }}>
						({totalEvents || "..."} events)
					</span>
				)}
			</button>

			{open && (
				<div style={{ maxHeight: 300, overflow: "auto", padding: "8px 12px" }}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							marginBottom: 8,
						}}
					>
						<div style={{ display: "flex", gap: 4 }}>
							<TabButton
								label="Events"
								active={activeTab === "events"}
								onClick={() => setActiveTab("events")}
							/>
							<TabButton
								label="Timeline"
								active={activeTab === "timeline"}
								onClick={() => setActiveTab("timeline")}
							/>
						</div>
						<div style={{ display: "flex", gap: 8 }}>
							{onClear && (
								<button
									type="button"
									onClick={onClear}
									style={{
										padding: "2px 8px",
										background: "#6b2222",
										color: "#ffaaaa",
										border: "1px solid #933",
										borderRadius: 3,
										cursor: "pointer",
										fontFamily: "monospace",
										fontSize: 11,
									}}
								>
									Clear All Storage
								</button>
							)}
						</div>
					</div>

					{activeTab === "events" && (
						<>
							<div style={{ color: "#888", marginBottom: 8 }}>
								Event Inspector
							</div>
							{logs.map((log) => (
								<WorkflowLog key={log.id} log={log} />
							))}
						</>
					)}

					{activeTab === "timeline" && <TimelineView logs={logs} />}
				</div>
			)}
		</div>
	);
}

function TabButton({
	label,
	active,
	onClick,
}: {
	label: string;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onClick}
			style={{
				padding: "2px 10px",
				background: active ? "#1e1e1e" : "transparent",
				color: active ? "#d4d4d4" : "#888",
				border: active ? "1px solid #555" : "1px solid transparent",
				borderBottom: active ? "1px solid #1e1e1e" : "1px solid #555",
				borderRadius: "3px 3px 0 0",
				cursor: "pointer",
				fontFamily: "monospace",
				fontSize: 11,
			}}
		>
			{label}
		</button>
	);
}

function TimelineView({ logs }: { logs: WorkflowEventLog[] }) {
	const data = buildTimelineData(logs);

	if (data.rows.length === 0) {
		return (
			<div data-testid="timeline-view" style={{ color: "#888" }}>
				No workflows
			</div>
		);
	}

	return (
		<div data-testid="timeline-view">
			{data.rows.map((row) => (
				<div
					key={row.workflowId}
					data-testid="timeline-row"
					style={{
						display: "flex",
						alignItems: "center",
						marginBottom: 4,
						height: 28,
					}}
				>
					<div
						style={{
							width: 100,
							flexShrink: 0,
							color: "#569cd6",
							fontSize: 11,
							overflow: "hidden",
							textOverflow: "ellipsis",
							whiteSpace: "nowrap",
						}}
					>
						{row.workflowId}
					</div>
					<div
						style={{
							flex: 1,
							position: "relative",
							height: "100%",
							background: "#2a2a2a",
							borderRadius: 2,
						}}
					>
						{row.spans.map((span) => (
							<div
								key={`${span.seq}-${span.startType}`}
								data-testid="timeline-span"
								title={`${span.name} (${span.startType} → ${span.endType})`}
								style={{
									position: "absolute",
									left: `${span.startPos * 100}%`,
									width: `${(span.endPos - span.startPos) * 100}%`,
									top: 4,
									height: 20,
									background: span.color,
									opacity: 0.6,
									borderRadius: 2,
									minWidth: 2,
								}}
							/>
						))}
						{row.markers.map((marker, i) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: markers have no stable id
								key={i}
								data-testid="timeline-marker"
								title={`${marker.type}: ${marker.label}`}
								style={{
									position: "absolute",
									left: `${marker.pos * 100}%`,
									top: 8,
									width: 8,
									height: 8,
									background: marker.color,
									borderRadius: "50%",
									transform: "translateX(-4px)",
								}}
							/>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function WorkflowLog({ log }: { log: WorkflowEventLog }) {
	return (
		<div style={{ marginBottom: 12 }}>
			<div
				style={{
					color: "#569cd6",
					fontWeight: "bold",
					marginBottom: 4,
				}}
			>
				{log.id}{" "}
				<span style={{ color: "#888", fontWeight: "normal" }}>
					({log.events.length} events)
				</span>
			</div>
			{log.events.length === 0 ? (
				<div style={{ color: "#666", paddingLeft: 12 }}>No events</div>
			) : (
				<table
					style={{
						width: "100%",
						borderCollapse: "collapse",
						fontSize: 11,
					}}
				>
					<thead>
						<tr style={{ color: "#888", textAlign: "left" }}>
							<th style={{ padding: "2px 8px", width: 30 }}>#</th>
							<th style={{ padding: "2px 8px" }}>Type</th>
							<th style={{ padding: "2px 8px" }}>Details</th>
							<th style={{ padding: "2px 8px", width: 80 }}>Time</th>
						</tr>
					</thead>
					<tbody>
						{log.events.map((event, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: events are append-only
							<EventRow key={i} index={i} event={event} />
						))}
					</tbody>
				</table>
			)}
		</div>
	);
}

function EventRow({ index, event }: { index: number; event: WorkflowEvent }) {
	const details = formatDetails(event);
	const color = eventColor(event.type);

	return (
		<tr style={{ borderTop: "1px solid #333" }}>
			<td style={{ padding: "2px 8px", color: "#888" }}>{index}</td>
			<td style={{ padding: "2px 8px", color }}>{event.type}</td>
			<td style={{ padding: "2px 8px", color: "#ce9178" }}>{details}</td>
			<td style={{ padding: "2px 8px", color: "#888" }}>
				{new Date(event.timestamp).toLocaleTimeString()}
			</td>
		</tr>
	);
}

function formatDetails(event: WorkflowEvent): string {
	switch (event.type) {
		case "activity_scheduled":
			return event.name;
		case "activity_completed":
			return truncate(JSON.stringify(event.result));
		case "activity_failed":
			return event.error;
		case "signal_received":
			return `${event.signal} = ${truncate(JSON.stringify(event.payload))}`;
		case "workflow_completed":
			return truncate(JSON.stringify(event.result));
		case "workflow_failed":
			return event.error;
		case "workflow_dependency_started":
			return event.workflowId;
		case "workflow_dependency_completed":
			return `${event.workflowId} = ${truncate(JSON.stringify(event.result))}`;
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
		case "wait_all_started":
			return event.items
				.map((i) => (i.kind === "signal" ? i.name : `workflow:${i.workflowId}`))
				.join(", ");
		case "wait_all_completed":
			return truncate(JSON.stringify(event.results));
		default:
			return "";
	}
}

function truncate(str: string, max = 60): string {
	return str.length > max ? `${str.slice(0, max)}...` : str;
}

function eventColor(type: string): string {
	if (type.includes("completed")) return "#4ec9b0";
	if (type.includes("failed")) return "#f44747";
	if (type.includes("started") || type.includes("scheduled")) return "#dcdcaa";
	if (type.includes("signal")) return "#c586c0";
	return "#d4d4d4";
}

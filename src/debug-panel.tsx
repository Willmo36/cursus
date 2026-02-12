// ABOUTME: Reusable debug panel that shows live workflow event logs.
// ABOUTME: Reads events from the registry in realtime via useWorkflowEvents.

import { useState } from "react";
import type { WorkflowEvent } from "./types";
import {
	useWorkflowEvents,
	type WorkflowEventLog,
} from "./use-workflow-events";

type WorkflowDebugPanelProps = {
	onClear?: () => void;
};

export function WorkflowDebugPanel({ onClear }: WorkflowDebugPanelProps) {
	const logs = useWorkflowEvents();
	const [open, setOpen] = useState(false);

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
						<span style={{ color: "#888" }}>Event Inspector</span>
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

					{logs.map((log) => (
						<WorkflowLog key={log.id} log={log} />
					))}
				</div>
			)}
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
			return event.signals.join(", ");
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

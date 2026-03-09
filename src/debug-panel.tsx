// ABOUTME: Reusable debug panel that shows live workflow event logs.
// ABOUTME: Reads events from the registry in realtime via useWorkflowEvents.

import { useState } from "react";
import {
	buildTimelineData,
	eventColor,
	formatDetails,
	formatDuration,
} from "./devtools-data";
import type { WorkflowEvent, WorkflowEventLog } from "./types";
import { useWorkflowEvents } from "./use-workflow-events";

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
			<div
				data-testid="timeline-axis"
				style={{
					display: "flex",
					alignItems: "flex-end",
					height: 20,
					marginBottom: 2,
					paddingLeft: 100,
				}}
			>
				<div style={{ flex: 1, position: "relative", height: "100%" }}>
					{data.ticks.map((tick) => (
						<div
							key={tick.label}
							data-testid="timeline-tick"
							style={{
								position: "absolute",
								left: `${tick.pos * 100}%`,
								bottom: 0,
								transform: "translateX(-50%)",
								fontSize: 9,
								color: "#666",
								whiteSpace: "nowrap",
							}}
						>
							{tick.label}
						</div>
					))}
				</div>
			</div>
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
								title={`${span.name} (${formatDuration(span.durationMs)})`}
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
									overflow: "hidden",
									display: "flex",
									alignItems: "center",
									paddingLeft: 4,
								}}
							>
								<span
									style={{
										fontSize: 9,
										color: "#1e1e1e",
										fontWeight: "bold",
										whiteSpace: "nowrap",
									}}
								>
									{span.name} {formatDuration(span.durationMs)}
								</span>
							</div>
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
			<TimelineLegend />
		</div>
	);
}

const LEGEND_ITEMS = [
	{ label: "Scheduled", color: "#dcdcaa" },
	{ label: "Completed", color: "#4ec9b0" },
	{ label: "Failed", color: "#f44747" },
	{ label: "Signal", color: "#c586c0" },
] as const;

function TimelineLegend() {
	return (
		<div
			data-testid="timeline-legend"
			style={{
				display: "flex",
				gap: 12,
				paddingLeft: 100,
				marginTop: 6,
				fontSize: 9,
				color: "#888",
			}}
		>
			{LEGEND_ITEMS.map((item) => (
				<div
					key={item.label}
					style={{ display: "flex", alignItems: "center", gap: 4 }}
				>
					<div
						style={{
							width: 8,
							height: 8,
							borderRadius: 2,
							background: item.color,
							opacity: 0.8,
						}}
					/>
					{item.label}
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

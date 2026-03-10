// ABOUTME: Devtools entry point for cursus.
// ABOUTME: Re-exports the data layer (framework-agnostic) and React debug panel.

export { WorkflowDebugPanel } from "./debug-panel";
export type {
	TimelineData,
	TimelineMarker,
	TimelineRow,
	TimelineSpan,
	TimelineTick,
} from "./devtools-data";
export {
	buildTimelineData,
	computeTicks,
	eventColor,
	formatDetails,
	formatDuration,
	markerLabel,
	spanName,
	truncate,
} from "./devtools-data";

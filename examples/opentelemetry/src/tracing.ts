// ABOUTME: OpenTelemetry tracer setup and workflow event observer.
// ABOUTME: Maps workflow events to OTel spans, exported to the browser console.

import { context, type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import {
	ConsoleSpanExporter,
	SimpleSpanProcessor,
	WebTracerProvider,
} from "@opentelemetry/sdk-trace-web";
import type { WorkflowEvent, WorkflowEventObserver } from "react-workflow";

// --- Provider setup ---

const provider = new WebTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
provider.register();

const tracer = trace.getTracer("react-workflow");

// --- Span management ---

// Root span per workflow run, keyed by workflowId
const workflowSpans = new Map<string, Span>();
// Activity spans keyed by `${workflowId}:${seq}`
const activitySpans = new Map<string, Span>();

function spanKey(workflowId: string, seq: number): string {
	return `${workflowId}:${seq}`;
}

// --- Event → Span mapping ---

function handleEvent(workflowId: string, event: WorkflowEvent): void {
	switch (event.type) {
		case "workflow_started": {
			const span = tracer.startSpan(`workflow:${workflowId}`);
			workflowSpans.set(workflowId, span);
			break;
		}

		case "activity_scheduled": {
			const parent = workflowSpans.get(workflowId);
			const ctx = parent
				? trace.setSpan(context.active(), parent)
				: context.active();
			const span = tracer.startSpan(`activity:${event.name}`, {}, ctx);
			activitySpans.set(spanKey(workflowId, event.seq), span);
			break;
		}

		case "activity_completed": {
			const span = activitySpans.get(spanKey(workflowId, event.seq));
			if (span) {
				span.setStatus({ code: SpanStatusCode.OK });
				span.end();
				activitySpans.delete(spanKey(workflowId, event.seq));
			}
			break;
		}

		case "activity_failed": {
			const span = activitySpans.get(spanKey(workflowId, event.seq));
			if (span) {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: event.error,
				});
				span.end();
				activitySpans.delete(spanKey(workflowId, event.seq));
			}
			break;
		}

		case "workflow_completed": {
			const span = workflowSpans.get(workflowId);
			if (span) {
				span.setStatus({ code: SpanStatusCode.OK });
				span.end();
				workflowSpans.delete(workflowId);
			}
			break;
		}

		case "workflow_failed": {
			const span = workflowSpans.get(workflowId);
			if (span) {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: event.error,
				});
				span.end();
				workflowSpans.delete(workflowId);
			}
			break;
		}

		case "workflow_cancelled": {
			const span = workflowSpans.get(workflowId);
			if (span) {
				span.setStatus({
					code: SpanStatusCode.ERROR,
					message: "cancelled",
				});
				span.end();
				workflowSpans.delete(workflowId);
			}
			break;
		}

		// Timer, signal, child, race events are informational — add as span events
		default: {
			const span = workflowSpans.get(workflowId);
			span?.addEvent(event.type, {
				timestamp: event.timestamp,
			});
			break;
		}
	}
}

// --- Exported observer ---

export const tracingObserver: WorkflowEventObserver = handleEvent;

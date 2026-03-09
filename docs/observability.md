---
sidebar_position: 7
---

# Observability

cursus emits structured events for every workflow operation. You can observe these events for logging, tracing, analytics, or debugging.

## WorkflowEventObserver

An observer is a function that receives every event as it's appended to the log:

```ts
import type { WorkflowEventObserver } from "cursus";

const logger: WorkflowEventObserver = (workflowId, event) => {
  console.log(`[${workflowId}] ${event.type}`, event);
};
```

### In Layers

Pass observers via `onEvent` in `createLayer`:

```ts
const layer = createLayer(workflows, storage, {
  onEvent: logger,
});

// Or multiple observers:
const layer = createLayer(workflows, storage, {
  onEvent: [logger, analyticsObserver],
});
```

### In Inline Workflows

Pass observers via `onEvent` in `useWorkflow` options:

```tsx
const { state } = useWorkflow("checkout", checkoutWorkflow, {
  storage,
  onEvent: (workflowId, event) => {
    console.log(event.type);
  },
});
```

## Event Types

Every workflow operation produces one or more events:

| Event | Fields | When |
|-------|--------|------|
| `workflow_started` | `timestamp` | Workflow begins |
| `workflow_completed` | `result`, `timestamp` | Workflow returns |
| `workflow_failed` | `error`, `stack?`, `timestamp` | Uncaught error |
| `workflow_cancelled` | `timestamp` | Workflow cancelled |
| `activity_scheduled` | `name`, `seq`, `timestamp` | Activity starts |
| `activity_completed` | `seq`, `result`, `timestamp` | Activity succeeds |
| `activity_failed` | `seq`, `error`, `stack?`, `timestamp` | Activity throws |
| `signal_received` | `signal`, `payload`, `seq`, `timestamp` | Signal delivered |
| `timer_started` | `seq`, `durationMs`, `timestamp` | Sleep begins |
| `timer_fired` | `seq`, `timestamp` | Sleep completes |
| `child_started` | `name`, `workflowId`, `seq`, `timestamp` | Child workflow begins |
| `child_completed` | `workflowId`, `seq`, `result`, `timestamp` | Child workflow returns |
| `child_failed` | `workflowId`, `seq`, `error`, `stack?`, `timestamp` | Child workflow throws |
| `wait_all_started` | `items`, `seq`, `timestamp` | waitForAll begins |
| `wait_all_completed` | `seq`, `results`, `timestamp` | All items resolved |
| `workflow_dependency_started` | `workflowId`, `seq`, `timestamp` | waitForWorkflow begins |
| `workflow_dependency_completed` | `workflowId`, `seq`, `result`, `timestamp` | Dependency resolved |
| `workflow_dependency_failed` | `workflowId`, `seq`, `error`, `stack?`, `timestamp` | Dependency failed |
| `race_started` | `seq`, `items`, `timestamp` | Race begins |
| `race_completed` | `seq`, `winner`, `value`, `timestamp` | Race resolved |
| `workflow_published` | `value`, `seq`, `timestamp` | Workflow published a value |

## Event Versioning

Every workflow's events can be wrapped in a `WorkflowTrace` envelope that includes version metadata. This is the integration point for monitoring tools that need to accept events from multiple library versions.

```ts
import { WorkflowRegistry, EVENT_SCHEMA_VERSION, LIBRARY_VERSION } from "cursus";

const trace = registry.getTrace("checkout");
// {
//   schemaVersion: 1,
//   libraryVersion: "0.1.0",
//   workflowId: "checkout",
//   events: [ ... ]
// }
```

- **`schemaVersion`** — monotonic integer, bumped when event shapes change
- **`libraryVersion`** — the npm package version that produced the events

A JSON Schema (`eventSchema`) is also exported for validating traces from external sources:

```ts
import { eventSchema } from "cursus";
import Ajv from "ajv/dist/2020";

const validate = new Ajv().compile(eventSchema);
const valid = validate(trace);
```

## useWorkflowEvents

The `useWorkflowEvents` hook gives you live event logs for all workflows in the current layer. It re-renders when events are appended:

```tsx
import { useWorkflowEvents } from "cursus/react";

function EventInspector() {
  const logs = useWorkflowEvents();

  return (
    <div>
      {logs.map((log) => (
        <div key={log.id}>
          <h3>{log.id}</h3>
          <ul>
            {log.events.map((event, i) => (
              <li key={i}>{event.type}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

Returns `WorkflowEventLog[]`:

```ts
type WorkflowEventLog = {
  id: string;            // workflow ID
  events: WorkflowEvent[];
};
```

Requires a `WorkflowLayerProvider` ancestor.

## WorkflowDebugPanel

A ready-made debug panel component with two views:

- **Events** — tabular event log per workflow
- **Timeline** — visual timeline with spans and markers

```tsx
import { WorkflowDebugPanel } from "cursus/devtools";

function App() {
  return (
    <WorkflowLayerProvider layer={layer}>
      <MyApp />
      <WorkflowDebugPanel />
    </WorkflowLayerProvider>
  );
}
```

The panel renders as a fixed-position bar at the bottom of the viewport with a show/hide toggle.

### Props

| Prop | Type | Description |
|------|------|-------------|
| `onClear` | `() => void` | Optional callback for a "Clear All Storage" button |

## OpenTelemetry Integration

The observer pattern integrates with any tracing system. Here's a sketch using OpenTelemetry:

```ts
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("cursus");
const spans = new Map<string, ReturnType<typeof tracer.startSpan>>();

const otelObserver: WorkflowEventObserver = (workflowId, event) => {
  const key = `${workflowId}:${event.type}`;

  switch (event.type) {
    case "activity_scheduled":
      spans.set(`${workflowId}:${event.seq}`, tracer.startSpan(event.name));
      break;
    case "activity_completed": {
      const span = spans.get(`${workflowId}:${event.seq}`);
      span?.end();
      break;
    }
    case "activity_failed": {
      const span = spans.get(`${workflowId}:${event.seq}`);
      span?.recordException(new Error(event.error));
      span?.end();
      break;
    }
  }
};
```

See the `examples/opentelemetry` directory for a complete implementation.

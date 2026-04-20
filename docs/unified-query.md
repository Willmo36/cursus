# Workflow-query hydration on replay

Event `query_resolved` is now two events:

- `query_resolved { label, value, seq, timestamp }` — signal-resolved queries. Value is logged and replayed verbatim, as before.
- `workflow_query_resolved { label, seq, timestamp }` — marker only, no value. Written when a `query` resolves from a registered workflow. On replay the registry re-hydrates the producer live and the marker hands back whatever the producer currently publishes.

This lets registered workflows publish non-serializable values (functions, class instances, service bundles) without corrupting replay under durable storage. The value never touches the log.

## Replay semantics, per case

- Signal-resolved: unchanged.
- Workflow-resolved: registry is asked again. Consumers always see the producer's current state.
- Fallthrough to signal wait: unchanged.

## Breaking

`EVENT_SCHEMA_VERSION` bumped to 3. Logs from schema v2 with a `query_resolved` event whose label is now a registered workflow fail loudly on replay; clear the log to reset. No migration path — pre-1.0.

## Files touched

- `src/types.ts` — `WorkflowQueryResolvedEvent`, added to `WorkflowEvent` union.
- `src/interpreter.ts` — `executeQuery`, `executeAll`, `executeRace` query branches: registry-resolved writes marker instead of `query_resolved`; replay re-hydrates via registry.
- `src/event-schema.json` — schema for the new event.
- `src/devtools-data.ts` — renders marker as `"${label} (live)"`.
- `src/version.ts` — `EVENT_SCHEMA_VERSION` 2 → 3.

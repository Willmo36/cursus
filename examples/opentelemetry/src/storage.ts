// ABOUTME: Shared LocalStorage instance for the opentelemetry example.
// ABOUTME: Uses "otel" prefix to namespace workflow event data.
import { LocalStorage } from "react-workflow";

export const storage = new LocalStorage("otel");

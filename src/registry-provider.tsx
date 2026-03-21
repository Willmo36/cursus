// ABOUTME: Shared React context for the workflow registry.
// ABOUTME: Used internally by createBindings, useWorkflow, and useWorkflowEvents.

import { createContext } from "react";
import type { WorkflowRegistry } from "./registry";

export const RegistryContext = createContext<WorkflowRegistry | null>(null);

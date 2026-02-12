// ABOUTME: Shared storage instance for the checkout example.
// ABOUTME: Exported so both the provider and debug panel can access it.
import { LocalStorage } from "react-workflow";

export const storage = new LocalStorage();

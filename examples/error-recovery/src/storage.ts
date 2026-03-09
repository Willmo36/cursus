// ABOUTME: Shared storage instance for the error recovery example.
// ABOUTME: Uses "error-recovery" prefix to namespace workflow event data.
import { LocalStorage } from "cursus";

export const storage = new LocalStorage("error-recovery");

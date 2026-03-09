// ABOUTME: Shared LocalStorage instance for the env-config example.
// ABOUTME: Uses "env-config" prefix to namespace workflow event data.
import { LocalStorage } from "cursus";

export const storage = new LocalStorage("env-config");

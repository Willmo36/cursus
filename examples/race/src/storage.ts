// ABOUTME: Shared storage instance for the race example.
// ABOUTME: Uses "race" prefix to namespace workflow event data.
import { LocalStorage } from "cursus";

export const storage = new LocalStorage("race");

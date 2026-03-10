// ABOUTME: Shared LocalStorage instance for the subscribe example.
// ABOUTME: Uses "subscribe" prefix to namespace workflow event data.
import { LocalStorage } from "cursus";

export const storage = new LocalStorage("subscribe");

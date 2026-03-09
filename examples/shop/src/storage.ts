// ABOUTME: Shared LocalStorage instance for the shop example.
// ABOUTME: Uses "shop" prefix to namespace workflow event data.
import { LocalStorage } from "cursus";

export const storage = new LocalStorage("shop");

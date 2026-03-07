// ABOUTME: Shared LocalStorage instance for the publish example.
// ABOUTME: Uses "publish" prefix to namespace workflow event data.
import { LocalStorage } from "react-workflow";

export const storage = new LocalStorage("publish");

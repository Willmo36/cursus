// ABOUTME: React context for the error simulation toggle.
// ABOUTME: Provides the force-error flag and API fetch wrapper to the component tree.
import { createContext, useContext } from "react";
import type { ApiFetch } from "./api";

type ErrorToggleContext = {
	forceError: boolean;
	setForceError: (value: boolean) => void;
	apiFetch: ApiFetch;
};

export const ErrorToggleCtx = createContext<ErrorToggleContext>(null!);

export function useErrorToggle() {
	return useContext(ErrorToggleCtx);
}

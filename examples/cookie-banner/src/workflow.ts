// ABOUTME: Cookie consent workflow that waits for a single user choice.
// ABOUTME: Demonstrates waitFor with a discriminated union payload.
import type { WorkflowFunction } from "react-workflow";

export type CookieChoice =
	| { type: "accept-all" }
	| { type: "reject-all" }
	| { type: "customize"; analytics: boolean; marketing: boolean };

type CookieSignals = {
	"cookie-choice": CookieChoice;
};

export type CookiePreferences = {
	necessary: boolean;
	analytics: boolean;
	marketing: boolean;
};

export const cookieWorkflow: WorkflowFunction<
	CookiePreferences,
	CookieSignals
> = function* (ctx) {
	const choice = yield* ctx.waitFor("cookie-choice");

	switch (choice.type) {
		case "accept-all":
			return { necessary: true, analytics: true, marketing: true };
		case "reject-all":
			return { necessary: true, analytics: false, marketing: false };
		case "customize":
			return {
				necessary: true,
				analytics: choice.analytics,
				marketing: choice.marketing,
			};
	}
};

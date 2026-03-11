// ABOUTME: Cookie consent workflow that waits for a single user choice.
// ABOUTME: Demonstrates receive with a discriminated union payload.
import { receive, workflow } from "cursus";

export type CookieChoice =
	| { type: "accept-all" }
	| { type: "reject-all" }
	| { type: "customize"; analytics: boolean; marketing: boolean };

export type CookiePreferences = {
	necessary: boolean;
	analytics: boolean;
	marketing: boolean;
};

export const cookieWorkflow = workflow(function* () {
	const choice = yield* receive<CookieChoice, "cookie-choice">("cookie-choice");

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
});

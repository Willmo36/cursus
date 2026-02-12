// ABOUTME: Chat room workflow that accumulates messages in a loop until closed.
// ABOUTME: Demonstrates waitFor in a loop with discriminated union events.
import type { WorkflowFunction } from "react-workflow";

export type ChatMessage = {
	username: string;
	text: string;
	timestamp: number;
};

type ChatEvent =
	| { type: "message"; username: string; text: string }
	| { type: "close" };

type ChatSignals = {
	"chat-event": ChatEvent;
};

export const chatWorkflow: WorkflowFunction<
	ChatMessage[],
	ChatSignals
> = function* (ctx) {
	const messages: ChatMessage[] = [];

	for (;;) {
		const event = yield* ctx.waitFor("chat-event");

		if (event.type === "close") {
			return messages;
		}

		messages.push({
			username: event.username,
			text: event.text,
			timestamp: Date.now(),
		});
	}
};

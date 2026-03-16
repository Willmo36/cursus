// ABOUTME: Chat room workflow that accumulates messages in a loop until closed.
// ABOUTME: Demonstrates receive in a loop with discriminated union events.
import { query, workflow } from "cursus";

export type ChatMessage = {
	username: string;
	text: string;
	timestamp: number;
};

type ChatEvent =
	| { type: "message"; username: string; text: string }
	| { type: "close" };

export const chatWorkflow = workflow(function* () {
	const messages: ChatMessage[] = [];

	for (;;) {
		const event = yield* query("chat-event").as<ChatEvent>();

		if (event.type === "close") {
			return messages;
		}

		messages.push({
			username: event.username,
			text: event.text,
			timestamp: Date.now(),
		});
	}
});

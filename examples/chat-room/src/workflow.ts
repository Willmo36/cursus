// ABOUTME: Chat room workflow that accumulates messages in a loop until closed.
// ABOUTME: Demonstrates waitFor in a loop with discriminated union events.
import { workflow } from "cursus";
import type { WorkflowContext } from "cursus";

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

export const chatWorkflow = workflow(function* (
	ctx: WorkflowContext<ChatSignals>,
) {
		const messages: ChatMessage[] = [];

		for (;;) {
			const event = yield* ctx.receive("chat-event");

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

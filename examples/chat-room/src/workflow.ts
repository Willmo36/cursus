// ABOUTME: Chat room workflow that accumulates messages in a loop until closed.
// ABOUTME: Demonstrates waitFor in a loop with discriminated union events.
import type { WorkflowContext, WorkflowFunction } from "react-workflow";

export type ChatMessage = {
	username: string;
	text: string;
	timestamp: number;
};

type ChatEvent =
	| { type: "message"; username: string; text: string }
	| { type: "close" };

export const chatWorkflow: WorkflowFunction<ChatMessage[]> = function* (
	ctx: WorkflowContext,
) {
	const messages: ChatMessage[] = [];

	for (;;) {
		const event = yield* ctx.waitFor<ChatEvent>("chat-event");

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

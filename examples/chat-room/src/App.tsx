// ABOUTME: Chat room UI with username entry, message list, and close button.
// ABOUTME: Hydrates past messages from localStorage events on reload.
import { useEffect, useMemo, useState } from "react";
import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";
import type { ChatMessage } from "./workflow";
import { chatWorkflow } from "./workflow";

const storage = new LocalStorage();
const WORKFLOW_ID = "chat-room";

export function App() {
	const { state, result, waitingFor, signal, reset } = useWorkflow(
		WORKFLOW_ID,
		chatWorkflow,
		{ storage },
	);
	const [username, setUsername] = useState("");
	const [joined, setJoined] = useState(false);
	const [text, setText] = useState("");
	const hydrated = useHydratedMessages();

	const isActive = state === "waiting" && waitingFor === "chat-event";

	return (
		<div style={{ maxWidth: 500, margin: "40px auto", fontFamily: "system-ui" }}>
			<h1>Chat Room</h1>

			{!joined && state !== "completed" && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (username.trim()) setJoined(true);
					}}
				>
					<input
						type="text"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						placeholder="Enter your username"
						required
						style={{ padding: 8, marginRight: 8 }}
					/>
					<button type="submit">Join</button>
				</form>
			)}

			{joined && isActive && (
				<div>
					<MessageList messages={hydrated} />
					<form
						onSubmit={(e) => {
							e.preventDefault();
							if (text.trim()) {
								signal("chat-event", {
									type: "message",
									username,
									text: text.trim(),
								});
								setText("");
							}
						}}
						style={{ display: "flex", gap: 8, marginTop: 8 }}
					>
						<input
							type="text"
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Type a message..."
							style={{ flex: 1, padding: 8 }}
						/>
						<button type="submit">Send</button>
					</form>
					<button
						type="button"
						onClick={() => signal("chat-event", { type: "close" })}
						style={{
							marginTop: 16,
							padding: "8px 16px",
							background: "#f44336",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
						}}
					>
						Close Room
					</button>
				</div>
			)}

			{state === "completed" && result && (
				<div>
					<h2>Room Closed</h2>
					<MessageList messages={result} />
					<p style={{ color: "#666" }}>
						{result.length} message{result.length !== 1 ? "s" : ""} total
					</p>
					<button type="button" onClick={reset}>
						New Room
					</button>
				</div>
			)}
		</div>
	);
}

function MessageList({ messages }: { messages: ChatMessage[] }) {
	return (
		<div
			style={{
				border: "1px solid #ddd",
				borderRadius: 8,
				padding: 12,
				minHeight: 200,
				maxHeight: 400,
				overflowY: "auto",
				background: "#fafafa",
			}}
		>
			{messages.length === 0 && (
				<p style={{ color: "#999", textAlign: "center" }}>No messages yet</p>
			)}
			{messages.map((msg, i) => (
				<div key={`${msg.timestamp}-${i}`} style={{ marginBottom: 8 }}>
					<strong>{msg.username}:</strong> {msg.text}
					<span style={{ fontSize: 11, color: "#999", marginLeft: 8 }}>
						{new Date(msg.timestamp).toLocaleTimeString()}
					</span>
				</div>
			))}
		</div>
	);
}

function useHydratedMessages(): ChatMessage[] {
	const [events, setEvents] = useState<ChatMessage[]>([]);

	useEffect(() => {
		storage.load(WORKFLOW_ID).then((log) => {
			const messages: ChatMessage[] = [];
			for (const event of log) {
				if (
					event.type === "signal_received" &&
					event.signal === "chat-event"
				) {
					const payload = event.payload as
						| { type: "message"; username: string; text: string }
						| { type: "close" };
					if (payload.type === "message") {
						messages.push({
							username: payload.username,
							text: payload.text,
							timestamp: event.timestamp,
						});
					}
				}
			}
			setEvents(messages);
		});
	}, []);

	return useMemo(() => events, [events]);
}

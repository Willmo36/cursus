// ABOUTME: SSO login UI that walks through the OAuth flow steps.
// ABOUTME: Shows connection status, a simulated callback button, and session info.
import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";
import { ssoWorkflow } from "./workflow";

const storage = new LocalStorage();

export function App() {
	const { state, result, receiving, signal, reset } = useWorkflow(
		"sso",
		ssoWorkflow,
		{ storage },
	);

	return (
		<div
			style={{ maxWidth: 480, margin: "40px auto", fontFamily: "system-ui" }}
		>
			<h1>SSO Login</h1>

			{state === "running" && !result && (
				<StatusMessage text="Connecting to provider..." />
			)}

			{state === "waiting" && receiving === "sso-callback" && (
				<div>
					<p>Waiting for SSO provider response...</p>
					<p style={{ fontSize: 13, color: "#666" }}>
						In a real app, the provider would redirect back to your app. Click
						below to simulate that callback.
					</p>
					<button
						type="button"
						onClick={() => signal("sso-callback", "auth_code_xyz789")}
						style={{
							padding: "10px 20px",
							background: "#1976D2",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
						}}
					>
						Simulate SSO Callback
					</button>
				</div>
			)}

			{state === "completed" && result && (
				<div>
					<h2>Authenticated</h2>
					<div
						style={{
							background: "#f5f5f5",
							padding: 16,
							borderRadius: 8,
						}}
					>
						<p>
							<strong>Provider:</strong> {result.provider}
						</p>
						<p>
							<strong>Email:</strong> {result.email}
						</p>
						<p style={{ fontSize: 12, color: "#666", wordBreak: "break-all" }}>
							<strong>Token:</strong> {result.accessToken}
						</p>
					</div>
					<button type="button" onClick={reset} style={{ marginTop: 16 }}>
						Log Out
					</button>
				</div>
			)}
		</div>
	);
}

function StatusMessage({ text }: { text: string }) {
	return <p style={{ color: "#666", fontStyle: "italic" }}>{text}</p>;
}

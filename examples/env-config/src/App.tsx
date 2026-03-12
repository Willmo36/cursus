// ABOUTME: UI for the env-config example showing resolved environment and user profile.
// ABOUTME: Both workflows auto-run on mount with no user interaction needed.
import { WorkflowDebugPanel } from "cursus/devtools";
import { useWorkflow } from "cursus/react";
import { storage } from "./storage";
import type { EnvConfig, UserProfile } from "./workflows";
import { userWorkflow } from "./workflows";

export function App() {
	return (
		<>
			<div
				style={{ maxWidth: 520, margin: "40px auto", fontFamily: "system-ui" }}
			>
				<h1>Environment Config</h1>
				<EnvSection />
				<hr
					style={{
						margin: "24px 0",
						border: "none",
						borderTop: "1px solid #ddd",
					}}
				/>
				<UserSection />
			</div>
			<WorkflowDebugPanel
				onClear={async () => {
					await storage.clear("env");
					await storage.clear("user");
					window.location.reload();
				}}
			/>
		</>
	);
}

function EnvSection() {
	const { state } = useWorkflow<EnvConfig>("env");

	if (state.status === "failed") {
		return (
			<div style={{ background: "#ffebee", padding: 16, borderRadius: 8 }}>
				<p style={{ color: "#c62828" }}>Failed to load environment: {state.error}</p>
			</div>
		);
	}

	if (state.status === "completed") {
		return (
			<div style={{ background: "#e8f5e9", padding: 16, borderRadius: 8 }}>
				<h2 style={{ marginTop: 0 }}>Environment</h2>
				<p>
					<strong>Base URL:</strong> {state.result.baseUrl}
				</p>
			</div>
		);
	}

	return <StatusMessage text="Loading environment..." />;
}

function UserSection() {
	const { state } = useWorkflow("user", userWorkflow, {
		storage,
	});

	if (state.status === "failed") {
		return (
			<div style={{ background: "#ffebee", padding: 16, borderRadius: 8 }}>
				<p style={{ color: "#c62828" }}>Failed to load user: {state.error}</p>
			</div>
		);
	}

	if (state.status === "completed") {
		const user = state.result as UserProfile;
		return (
			<div style={{ background: "#e3f2fd", padding: 16, borderRadius: 8 }}>
				<h2 style={{ marginTop: 0 }}>User Profile</h2>
				<p>
					<strong>ID:</strong> {user.id}
				</p>
				<p>
					<strong>Name:</strong> {user.name}
				</p>
				<p>
					<strong>Email:</strong> {user.email}
				</p>
			</div>
		);
	}

	return <StatusMessage text="Loading user profile..." />;
}

function StatusMessage({ text }: { text: string }) {
	return <p style={{ color: "#666", fontStyle: "italic" }}>{text}</p>;
}

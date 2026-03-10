// ABOUTME: UI for the race example.
// ABOUTME: Shows fetch-with-timeout and approval-with-escalation race patterns.

import { WorkflowDebugPanel } from "cursus/devtools";
import { useWorkflow } from "cursus/react";
import { useEffect, useState } from "react";
import { storage } from "./storage";
import {
	type ApprovalResult,
	approvalWorkflow,
	type FetchResult,
	fetchWorkflow,
} from "./workflows";

export function App() {
	return (
		<>
			<div
				style={{
					maxWidth: 520,
					margin: "40px auto",
					paddingBottom: 60,
					fontFamily: "system-ui",
				}}
			>
				<h1>Race: Fetch with Timeout</h1>
				<p style={{ color: "#666", marginBottom: 24 }}>
					Races a simulated API call (1.5–3.5s) against a 3s sleep timeout.
					Refresh to re-run — the random delay means it sometimes succeeds and
					sometimes times out.
				</p>
				<FetchFlow />

				<hr
					style={{
						margin: "40px 0",
						border: "none",
						borderTop: "1px solid #ddd",
					}}
				/>

				<h1>Race: Approval with Escalation</h1>
				<p style={{ color: "#666", marginBottom: 24 }}>
					Races a <code>waitFor("approve")</code> signal against a 10s sleep.
					Click "Approve" before the timer runs out, or let it escalate.
				</p>
				<ApprovalFlow />
			</div>
			<WorkflowDebugPanel
				onClear={async () => {
					await storage.clear("fetch");
					await storage.clear("approval");
					window.location.reload();
				}}
			/>
		</>
	);
}

function FetchFlow() {
	const { state, result } = useWorkflow<FetchResult>("fetch", fetchWorkflow, {
		storage,
	});

	if (state === "running") {
		return (
			<div
				style={{
					background: "#e3f2fd",
					padding: 16,
					borderRadius: 8,
				}}
			>
				<p style={{ margin: 0, color: "#1565c0" }}>
					Fetching data... (timeout in 3s)
				</p>
			</div>
		);
	}

	if (state === "completed" && result) {
		if (result.status === "ok") {
			return (
				<div
					style={{
						background: "#e8f5e9",
						padding: 16,
						borderRadius: 8,
					}}
				>
					<h2 style={{ margin: "0 0 8px", color: "#2e7d32" }}>Fetch Won</h2>
					<p style={{ margin: 0 }}>
						<strong>Data:</strong> {result.data}
					</p>
					<p
						style={{
							margin: "8px 0 0",
							color: "#666",
							fontSize: 14,
						}}
					>
						The activity resolved before the 3s timeout. Check the debug panel
						for <code>race_completed</code> with <code>winner: 0</code>.
					</p>
				</div>
			);
		}

		return (
			<div
				style={{
					background: "#fff3e0",
					padding: 16,
					borderRadius: 8,
				}}
			>
				<h2 style={{ margin: "0 0 8px", color: "#e65100" }}>Timeout Won</h2>
				<p style={{ margin: 0 }}>
					The API took too long — sleep fired after 3s.
				</p>
				<p
					style={{
						margin: "8px 0 0",
						color: "#666",
						fontSize: 14,
					}}
				>
					Check the debug panel for <code>race_completed</code> with{" "}
					<code>winner: 1</code>.
				</p>
			</div>
		);
	}

	if (state === "failed") {
		return (
			<div
				style={{
					background: "#ffebee",
					padding: 16,
					borderRadius: 8,
				}}
			>
				<p style={{ margin: 0, color: "#c62828" }}>Workflow failed</p>
			</div>
		);
	}

	return null;
}

function ApprovalFlow() {
	const { state, result, signal } = useWorkflow<
		ApprovalResult,
		{ approve: string }
	>("approval", approvalWorkflow, { storage });

	const [seconds, setSeconds] = useState(10);

	useEffect(() => {
		if (state !== "running") return;
		const id = setInterval(() => {
			setSeconds((s) => Math.max(0, s - 1));
		}, 1000);
		return () => clearInterval(id);
	}, [state]);

	if (state === "running") {
		return (
			<div
				style={{
					background: "#e3f2fd",
					padding: 16,
					borderRadius: 8,
				}}
			>
				<p style={{ margin: "0 0 12px", color: "#1565c0" }}>
					Waiting for approval... escalates in <strong>{seconds}s</strong>
				</p>
				<button
					type="button"
					onClick={() => signal("approve", "Manager")}
					style={{
						padding: "8px 20px",
						fontSize: 14,
						background: "#1565c0",
						color: "#fff",
						border: "none",
						borderRadius: 6,
						cursor: "pointer",
					}}
				>
					Approve
				</button>
			</div>
		);
	}

	if (state === "completed" && result) {
		if (result.status === "approved") {
			return (
				<div
					style={{
						background: "#e8f5e9",
						padding: 16,
						borderRadius: 8,
					}}
				>
					<h2 style={{ margin: "0 0 8px", color: "#2e7d32" }}>Approved</h2>
					<p style={{ margin: 0 }}>
						Approved by <strong>{result.by}</strong>.
					</p>
				</div>
			);
		}

		return (
			<div
				style={{
					background: "#fff3e0",
					padding: 16,
					borderRadius: 8,
				}}
			>
				<h2 style={{ margin: "0 0 8px", color: "#e65100" }}>Escalated</h2>
				<p style={{ margin: 0 }}>
					No approval within 10s — escalated to next level.
				</p>
			</div>
		);
	}

	if (state === "failed") {
		return (
			<div
				style={{
					background: "#ffebee",
					padding: 16,
					borderRadius: 8,
				}}
			>
				<p style={{ margin: 0, color: "#c62828" }}>Workflow failed</p>
			</div>
		);
	}

	return null;
}

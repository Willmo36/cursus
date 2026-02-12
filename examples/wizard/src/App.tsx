// ABOUTME: Signup wizard UI driven by the signup workflow.
// ABOUTME: Shows email input, then password input, then a spinner, then success.
import { useState } from "react";
import { LocalStorage, useWorkflow } from "react-workflow";
import { signupWorkflow } from "./workflow";

const storage = new LocalStorage();

export function App() {
	const { state, result, waitingFor, signal, reset } = useWorkflow(
		"signup",
		signupWorkflow,
		{ storage },
	);

	return (
		<div style={{ maxWidth: 400, margin: "40px auto", fontFamily: "system-ui" }}>
			<h1>Signup Wizard</h1>

			{state === "waiting" && waitingFor === "email" && (
				<EmailStep onSubmit={(email) => signal("email", email)} />
			)}

			{state === "waiting" && waitingFor === "password" && (
				<PasswordStep onSubmit={(password) => signal("password", password)} />
			)}

			{state === "running" && <p>Creating your account...</p>}

			{state === "completed" && result && (
				<div>
					<h2>Account Created</h2>
					<p>
						Welcome, <strong>{result.email}</strong>
					</p>
					<p style={{ fontSize: 12, color: "#666", wordBreak: "break-all" }}>
						Token: {result.token}
					</p>
					<button type="button" onClick={reset}>
						Start Over
					</button>
				</div>
			)}
		</div>
	);
}

function EmailStep({ onSubmit }: { onSubmit: (email: string) => void }) {
	const [email, setEmail] = useState("");

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (email.trim()) onSubmit(email.trim());
			}}
		>
			<h2>Step 1: Email</h2>
			<input
				type="email"
				value={email}
				onChange={(e) => setEmail(e.target.value)}
				placeholder="you@example.com"
				required
				style={{ width: "100%", padding: 8, marginBottom: 8 }}
			/>
			<button type="submit">Next</button>
		</form>
	);
}

function PasswordStep({ onSubmit }: { onSubmit: (password: string) => void }) {
	const [password, setPassword] = useState("");

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (password.length >= 4) onSubmit(password);
			}}
		>
			<h2>Step 2: Password</h2>
			<input
				type="password"
				value={password}
				onChange={(e) => setPassword(e.target.value)}
				placeholder="At least 4 characters"
				required
				minLength={4}
				style={{ width: "100%", padding: 8, marginBottom: 8 }}
			/>
			<button type="submit">Create Account</button>
		</form>
	);
}

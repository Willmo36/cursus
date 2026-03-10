// ABOUTME: Signup wizard UI driven by the signup workflow using all().
// ABOUTME: Shows email and password inputs together, collects both before creating account.
import { useState } from "react";
import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";
import { signupWorkflow } from "./workflow";

const storage = new LocalStorage();

export function App() {
	const { state, result, signal, reset } = useWorkflow(
		"signup",
		signupWorkflow,
		{ storage },
	);

	return (
		<div
			style={{ maxWidth: 400, margin: "40px auto", fontFamily: "system-ui" }}
		>
			<h1>Signup Wizard</h1>

			{state === "waiting" && (
				<SignupForm
					onSubmit={(email, password) => {
						signal("email", email);
						signal("password", password);
					}}
				/>
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

function SignupForm({
	onSubmit,
}: {
	onSubmit: (email: string, password: string) => void;
}) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (email.trim() && password.length >= 4) {
					onSubmit(email.trim(), password);
				}
			}}
		>
			<h2>Create Account</h2>
			<div style={{ marginBottom: 8 }}>
				<input
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@example.com"
					required
					style={{ width: "100%", padding: 8 }}
				/>
			</div>
			<div style={{ marginBottom: 8 }}>
				<input
					type="password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="At least 4 characters"
					required
					minLength={4}
					style={{ width: "100%", padding: 8 }}
				/>
			</div>
			<button type="submit">Create Account</button>
		</form>
	);
}

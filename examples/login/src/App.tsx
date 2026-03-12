// ABOUTME: Login form UI driven by the login workflow.
// ABOUTME: Shows a login form with error feedback on failure, and a greeting on success.

import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";
import { useState } from "react";
import { loginWorkflow } from "./workflow";

const storage = new LocalStorage();

export function App() {
	const { state, signal, reset } = useWorkflow(
		"login",
		loginWorkflow,
		{ storage },
	);

	return (
		<div
			style={{ maxWidth: 400, margin: "40px auto", fontFamily: "system-ui" }}
		>
			<h1>Login</h1>

			{state.status === "waiting" && (
				<LoginForm
					onSubmit={(username, password) =>
						signal("credentials", { username, password })
					}
				/>
			)}

			{state.status === "running" && <p>Authenticating...</p>}

			{state.status === "completed" && (
				<div>
					<h2>Welcome, {state.result.displayName}!</h2>
					<p>Logged in at {state.result.loginTime}</p>
					<button type="button" onClick={reset}>
						Log Out
					</button>
				</div>
			)}
		</div>
	);
}

function LoginForm({
	onSubmit,
}: {
	onSubmit: (username: string, password: string) => void;
}) {
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [showError, setShowError] = useState(false);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (password !== "secret") {
					setShowError(true);
				} else {
					setShowError(false);
				}
				onSubmit(username, password);
			}}
		>
			{showError && (
				<p style={{ color: "#f44336" }}>
					Invalid credentials. Hint: password is &quot;secret&quot;
				</p>
			)}
			<div style={{ marginBottom: 8 }}>
				<input
					type="text"
					value={username}
					onChange={(e) => setUsername(e.target.value)}
					placeholder="Username"
					required
					style={{ width: "100%", padding: 8 }}
				/>
			</div>
			<div style={{ marginBottom: 8 }}>
				<input
					type="password"
					value={password}
					onChange={(e) => {
						setPassword(e.target.value);
						setShowError(false);
					}}
					placeholder="Password"
					required
					style={{ width: "100%", padding: 8 }}
				/>
			</div>
			<button type="submit">Log In</button>
		</form>
	);
}

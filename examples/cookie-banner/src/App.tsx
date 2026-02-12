// ABOUTME: Cookie consent banner UI driven by the cookie workflow.
// ABOUTME: Shows a banner overlay until consent is given, with accept/reject/customize options.
import { useState } from "react";
import { LocalStorage, useWorkflow } from "react-workflow";
import type { CookiePreferences } from "./workflow";
import { cookieWorkflow } from "./workflow";

const storage = new LocalStorage();

export function App() {
	const { state, result, waitingFor, signal, reset } = useWorkflow(
		"cookies",
		cookieWorkflow,
		{ storage },
	);

	return (
		<div style={{ fontFamily: "system-ui", padding: 40 }}>
			<h1>My Website</h1>
			<p>This page uses cookies to improve your experience.</p>

			{state === "completed" && result && (
				<div>
					<PreferencesSummary preferences={result} />
					<button
						type="button"
						onClick={reset}
						style={{ marginTop: 16, cursor: "pointer" }}
					>
						Cookie Settings
					</button>
				</div>
			)}

			{state === "waiting" && waitingFor === "cookie-choice" && (
				<Banner signal={signal} />
			)}
		</div>
	);
}

function PreferencesSummary({
	preferences,
}: { preferences: CookiePreferences }) {
	return (
		<div
			style={{
				padding: 16,
				background: "#f0f0f0",
				borderRadius: 8,
				marginTop: 16,
			}}
		>
			<h3 style={{ marginTop: 0 }}>Current Cookie Preferences</h3>
			<ul style={{ listStyle: "none", padding: 0 }}>
				<li>Necessary: {preferences.necessary ? "Yes" : "No"}</li>
				<li>Analytics: {preferences.analytics ? "Yes" : "No"}</li>
				<li>Marketing: {preferences.marketing ? "Yes" : "No"}</li>
			</ul>
		</div>
	);
}

function Banner({
	signal,
}: { signal: (name: string, payload: unknown) => void }) {
	const [showCustomize, setShowCustomize] = useState(false);
	const [analytics, setAnalytics] = useState(false);
	const [marketing, setMarketing] = useState(false);

	return (
		<div
			style={{
				position: "fixed",
				bottom: 0,
				left: 0,
				right: 0,
				background: "#333",
				color: "white",
				padding: 24,
				boxShadow: "0 -2px 10px rgba(0,0,0,0.3)",
			}}
		>
			<h3 style={{ marginTop: 0 }}>We use cookies</h3>
			<p>
				We use cookies to enhance your browsing experience, serve personalized
				ads, and analyze our traffic.
			</p>

			{!showCustomize && (
				<div style={{ display: "flex", gap: 8 }}>
					<button
						type="button"
						onClick={() =>
							signal("cookie-choice", { type: "accept-all" })
						}
						style={{
							padding: "8px 16px",
							background: "#4CAF50",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
						}}
					>
						Accept All
					</button>
					<button
						type="button"
						onClick={() =>
							signal("cookie-choice", { type: "reject-all" })
						}
						style={{
							padding: "8px 16px",
							background: "#f44336",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
						}}
					>
						Reject All
					</button>
					<button
						type="button"
						onClick={() => setShowCustomize(true)}
						style={{
							padding: "8px 16px",
							background: "transparent",
							color: "white",
							border: "1px solid white",
							borderRadius: 4,
							cursor: "pointer",
						}}
					>
						Customize
					</button>
				</div>
			)}

			{showCustomize && (
				<div>
					<label style={{ display: "block", marginBottom: 8 }}>
						<input type="checkbox" checked disabled /> Necessary (required)
					</label>
					<label style={{ display: "block", marginBottom: 8 }}>
						<input
							type="checkbox"
							checked={analytics}
							onChange={(e) => setAnalytics(e.target.checked)}
						/>{" "}
						Analytics
					</label>
					<label style={{ display: "block", marginBottom: 8 }}>
						<input
							type="checkbox"
							checked={marketing}
							onChange={(e) => setMarketing(e.target.checked)}
						/>{" "}
						Marketing
					</label>
					<button
						type="button"
						onClick={() =>
							signal("cookie-choice", {
								type: "customize",
								analytics,
								marketing,
							})
						}
						style={{
							padding: "8px 16px",
							background: "#2196F3",
							color: "white",
							border: "none",
							borderRadius: 4,
							cursor: "pointer",
							marginTop: 8,
						}}
					>
						Save Preferences
					</button>
				</div>
			)}
		</div>
	);
}

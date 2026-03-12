// ABOUTME: Main layout for the subscribe example app.
// ABOUTME: Account store + points store demonstrating reactive subscribe with takeLatest.
import { WorkflowDebugPanel } from "cursus/devtools";
import { useWorkflow } from "./main";

function AccountPanel() {
	const { state, published, signal } = useWorkflow("account");

	const accountState = published as
		| { status: "loading" }
		| { status: "ready"; account: { name: string; tier: string } }
		| undefined;

	if (state.status === "waiting" && (!accountState || accountState.status === "loading")) {
		return (
			<div>
				<h2>Account</h2>
				<button onClick={() => signal("login", { name: "Max" })}>
					Log in as Max
				</button>
			</div>
		);
	}

	if (!accountState || accountState.status !== "ready") {
		return (
			<div>
				<h2>Account</h2>
				<p>Loading...</p>
			</div>
		);
	}

	return (
		<div>
			<h2>Account</h2>
			<p>
				{accountState.account.name} ({accountState.account.tier})
			</p>
			<button onClick={() => signal("upgrade", { tier: "pro" })}>
				Upgrade to Pro
			</button>
		</div>
	);
}

function PointsPanel() {
	const { published } = useWorkflow("points");
	const points = published as number | null | undefined;

	return (
		<div>
			<h2>Points</h2>
			{points == null ? <p>Waiting for account...</p> : <p>{points} points</p>}
		</div>
	);
}

export function App() {
	return (
		<div
			style={{
				maxWidth: 600,
				margin: "0 auto",
				padding: 20,
				fontFamily: "sans-serif",
			}}
		>
			<h1>Subscribe Example</h1>
			<p>
				The points store subscribes to the account store. When the account
				changes (e.g. upgrade), points automatically refetches with takeLatest
				semantics — cancelling any in-flight fetch.
			</p>
			<div style={{ display: "grid", gap: 20 }}>
				<AccountPanel />
				<PointsPanel />
			</div>
			<div style={{ marginTop: 40 }}>
				<WorkflowDebugPanel />
			</div>
		</div>
	);
}

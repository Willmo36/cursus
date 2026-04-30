// ABOUTME: Presentational product page component shared by server and client.
// ABOUTME: Renders product details, review form, and debug info from plain props.

import type { WorkflowEvent, WorkflowState } from "cursus";
import { useState } from "react";

import type { Product, ProductResult } from "./workflow";

type Snapshot = {
	workflowId: string;
	events: WorkflowEvent[];
	state: WorkflowState;
	published: unknown;
};

type ProductPageProps = {
	snapshot: Snapshot;
	product: Product | undefined;
	state: WorkflowState<ProductResult>;
	onSignal?: (name: string, payload: string) => void;
	onReset?: () => void;
};

export function ProductPage({
	snapshot,
	product,
	state,
	onSignal,
	onReset,
}: ProductPageProps) {
	return (
		<div
			style={{ maxWidth: 600, margin: "40px auto", fontFamily: "system-ui" }}
		>
			<h1>SSR Hydration Example</h1>
			<p style={{ color: "#666", fontSize: 14 }}>
				The product data was rendered on the server via a registry and{" "}
				<code>renderToString()</code>. No loading spinner needed.
			</p>

			{product && (
				<div
					style={{
						border: "1px solid #ddd",
						borderRadius: 8,
						padding: 24,
						marginBottom: 24,
					}}
				>
					<h2 style={{ margin: "0 0 8px" }}>{product.name}</h2>
					<p style={{ fontSize: 24, fontWeight: "bold", margin: "0 0 8px" }}>
						{product.price}
					</p>
					<p style={{ color: "#555" }}>{product.description}</p>
				</div>
			)}

			{state.status === "waiting" && (
				<ReviewForm onSubmit={(review) => onSignal?.("review", review)} />
			)}

			{state.status === "completed" && (
				<div>
					<p>
						<strong>Your review:</strong> {state.result.review}
					</p>
					<button type="button" onClick={onReset}>
						Start Over
					</button>
				</div>
			)}

			<div
				style={{
					marginTop: 32,
					padding: 16,
					background: "#f5f5f5",
					borderRadius: 8,
					fontSize: 13,
				}}
			>
				<strong>Debug</strong>
				<br />
				State: <code>{state.status}</code>
				<br />
				Snapshot state: <code>{snapshot.state.status}</code>
				<br />
				Events in snapshot: <code>{snapshot.events.length}</code>
			</div>
		</div>
	);
}

function ReviewForm({ onSubmit }: { onSubmit: (review: string) => void }) {
	const [text, setText] = useState("");

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (text.trim()) {
					onSubmit(text);
				}
			}}
		>
			<h3>Leave a Review</h3>
			<textarea
				value={text}
				onChange={(e) => setText(e.target.value)}
				placeholder="What did you think?"
				rows={3}
				style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
			/>
			<br />
			<button type="submit" style={{ marginTop: 8 }}>
				Submit Review
			</button>
		</form>
	);
}

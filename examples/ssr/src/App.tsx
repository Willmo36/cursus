// ABOUTME: Product detail page that hydrates from a server-side snapshot.
// ABOUTME: Demonstrates SSR pattern — product data renders immediately without loading flash.

import type { WorkflowSnapshot } from "cursus";
import { LocalStorage } from "cursus";
import { useWorkflow } from "cursus/react";
import { useState } from "react";

import type { Product, ProductResult, ProductSignals } from "./workflow";
import { productWorkflow } from "./workflow";

const storage = new LocalStorage("ssr");

export function App({ snapshot }: { snapshot: WorkflowSnapshot }) {
	const { state, result, published, waitingFor, signal, reset } = useWorkflow<
		ProductResult,
		ProductSignals,
		Record<string, never>,
		Product
	>("product", productWorkflow, { storage, snapshot });

	const product = (published ?? snapshot.published) as Product | undefined;

	return (
		<div
			style={{ maxWidth: 600, margin: "40px auto", fontFamily: "system-ui" }}
		>
			<h1>SSR Hydration Example</h1>
			<p style={{ color: "#666", fontSize: 14 }}>
				The product data was pre-fetched with <code>runWorkflow()</code> before
				React mounted. No loading spinner needed.
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

			{state === "waiting" && waitingFor === "review" && (
				<ReviewForm onSubmit={(review) => signal("review", review)} />
			)}

			{state === "completed" && result && (
				<div>
					<p>
						<strong>Your review:</strong> {result.review}
					</p>
					<button type="button" onClick={reset}>
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
				State: <code>{state}</code>
				<br />
				Snapshot state: <code>{snapshot.state}</code>
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

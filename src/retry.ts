// ABOUTME: Higher-order function that wraps an activity with automatic retry and backoff.
// ABOUTME: Retries happen inside a single activity call — transparent to the workflow event log.

export type RetryPolicy = {
	maxAttempts?: number;
	backoff?: "fixed" | "linear" | "exponential";
	initialDelayMs?: number;
	maxDelayMs?: number;
};

type ResolvedPolicy = {
	backoff: "fixed" | "linear" | "exponential";
	initialDelayMs: number;
	maxDelayMs: number;
};

export function calculateDelay(
	attempt: number,
	policy: ResolvedPolicy,
): number {
	let delay: number;
	switch (policy.backoff) {
		case "fixed":
			delay = policy.initialDelayMs;
			break;
		case "linear":
			delay = policy.initialDelayMs * (attempt + 1);
			break;
		case "exponential":
			delay = policy.initialDelayMs * 2 ** attempt;
			break;
	}
	return Math.min(delay, policy.maxDelayMs);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason ?? new Error("aborted"));
			return;
		}
		const timer = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal.reason ?? new Error("aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export function withRetry<T>(
	fn: (signal: AbortSignal) => Promise<T>,
	policy?: RetryPolicy,
): (signal: AbortSignal) => Promise<T> {
	const maxAttempts = policy?.maxAttempts ?? 3;
	const resolved: ResolvedPolicy = {
		backoff: policy?.backoff ?? "exponential",
		initialDelayMs: policy?.initialDelayMs ?? 1000,
		maxDelayMs: policy?.maxDelayMs ?? 30000,
	};

	return async (signal: AbortSignal): Promise<T> => {
		let lastError: unknown;
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			try {
				return await fn(signal);
			} catch (err) {
				lastError = err;
				if (attempt < maxAttempts - 1) {
					const delay = calculateDelay(attempt, resolved);
					await abortableDelay(delay, signal);
				}
			}
		}
		throw lastError;
	};
}

// ABOUTME: Higher-order functions that wrap activities with retry, circuit breaking, and composition.
// ABOUTME: All wrappers are transparent to the workflow event log — they're endomorphisms on (AbortSignal) → Promise<T>.

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

export class CircuitOpenError extends Error {
	constructor() {
		super("Circuit breaker is open");
		this.name = "CircuitOpenError";
	}
}

export type CircuitBreakerPolicy = {
	failureThreshold?: number;
	resetTimeoutMs?: number;
	halfOpenMax?: number;
};

type CircuitState = "closed" | "open" | "half-open";

export function withCircuitBreaker<T>(
	fn: (signal: AbortSignal) => Promise<T>,
	policy?: CircuitBreakerPolicy,
): (signal: AbortSignal) => Promise<T> {
	const failureThreshold = policy?.failureThreshold ?? 5;
	const resetTimeoutMs = policy?.resetTimeoutMs ?? 30000;

	let state: CircuitState = "closed";
	let failureCount = 0;
	let openedAt = 0;

	return async (signal: AbortSignal): Promise<T> => {
		if (state === "open") {
			if (Date.now() - openedAt >= resetTimeoutMs) {
				state = "half-open";
			} else {
				throw new CircuitOpenError();
			}
		}

		if (state === "half-open") {
			try {
				const result = await fn(signal);
				state = "closed";
				failureCount = 0;
				return result;
			} catch (err) {
				state = "open";
				openedAt = Date.now();
				throw err;
			}
		}

		// closed state
		try {
			const result = await fn(signal);
			failureCount = 0;
			return result;
		} catch (err) {
			failureCount++;
			if (failureCount >= failureThreshold) {
				state = "open";
				openedAt = Date.now();
			}
			throw err;
		}
	};
}

export type ActivityWrapper = <T>(
	fn: (signal: AbortSignal) => Promise<T>,
) => (signal: AbortSignal) => Promise<T>;

export function wrapActivity(...wrappers: ActivityWrapper[]): ActivityWrapper {
	return <T>(fn: (signal: AbortSignal) => Promise<T>) => {
		let wrapped = fn;
		for (let i = wrappers.length - 1; i >= 0; i--) {
			wrapped = wrappers[i](wrapped);
		}
		return wrapped;
	};
}

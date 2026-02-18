// ABOUTME: Tests for the withRetry higher-order function.
// ABOUTME: Covers retry behavior, backoff strategies, abort signal handling, and defaults.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateDelay, withRetry } from "./retry";

// Helpers that track call counts without vi.fn() to avoid the vitest spy wrapper
// creating intermediate rejected promises that trigger PromiseRejectionHandledWarning.

function alwaysFails(msg = "fail") {
	let calls = 0;
	const fn = async () => {
		calls++;
		throw new Error(msg);
	};
	return { fn, getCalls: () => calls };
}

function failsThenSucceeds<T>(failCount: number, successValue: T) {
	let calls = 0;
	const fn = async () => {
		calls++;
		if (calls <= failCount) throw new Error("fail");
		return successValue;
	};
	return { fn, getCalls: () => calls };
}

// Suppress PromiseRejectionHandledWarning caused by fake timers + async rejections.
// When advanceTimersByTimeAsync resolves a backoff timer, the retry loop calls fn()
// which rejects. Node briefly sees this as unhandled before the .then() handler
// processes the rejection on the next microtask. This is a false positive.
let unhandledRejections: unknown[] = [];
const captureRejection = (reason: unknown) => {
	unhandledRejections.push(reason);
};

beforeEach(() => {
	unhandledRejections = [];
	process.on("unhandledRejection", captureRejection);
	vi.useFakeTimers();
});

afterEach(() => {
	process.off("unhandledRejection", captureRejection);
	vi.useRealTimers();
});

describe("withRetry", () => {
	it("returns result on first success", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			return "ok";
		};
		const wrapped = withRetry(fn);
		const result = await wrapped(new AbortController().signal);
		expect(result).toBe("ok");
		expect(calls).toBe(1);
	});

	it("retries on failure and returns result on success", async () => {
		const { fn, getCalls } = failsThenSucceeds(1, "ok");
		const wrapped = withRetry(fn, { maxAttempts: 3, initialDelayMs: 100 });

		const promise = wrapped(new AbortController().signal);
		await vi.advanceTimersByTimeAsync(100);
		const result = await promise;

		expect(result).toBe("ok");
		expect(getCalls()).toBe(2);
	});

	it("exhausts maxAttempts and throws last error", async () => {
		const { fn, getCalls } = alwaysFails("always fails");
		const wrapped = withRetry(fn, { maxAttempts: 3, initialDelayMs: 100 });

		const promise = wrapped(new AbortController().signal);
		await vi.advanceTimersByTimeAsync(100);
		await vi.advanceTimersByTimeAsync(200);

		await expect(promise).rejects.toThrow("always fails");
		expect(getCalls()).toBe(3);
	});

	it("respects AbortSignal during backoff", async () => {
		const { fn, getCalls } = alwaysFails();
		const wrapped = withRetry(fn, { maxAttempts: 3, initialDelayMs: 1000 });

		const controller = new AbortController();
		const promise = wrapped(controller.signal);

		// First attempt fails, now sleeping before retry
		await vi.advanceTimersByTimeAsync(500);
		controller.abort();

		await expect(promise).rejects.toThrow("aborted");
		expect(getCalls()).toBe(1);
	});

	it("respects AbortSignal passed to activity fn", async () => {
		let receivedSignal: AbortSignal | undefined;
		const fn = async (signal: AbortSignal) => {
			receivedSignal = signal;
			return "ok";
		};
		const wrapped = withRetry(fn);
		const controller = new AbortController();
		await wrapped(controller.signal);

		expect(receivedSignal).toBe(controller.signal);
	});

	it("uses exponential backoff delays", async () => {
		const { fn, getCalls } = alwaysFails();
		const wrapped = withRetry(fn, {
			maxAttempts: 4,
			backoff: "exponential",
			initialDelayMs: 1000,
		});

		const promise = wrapped(new AbortController().signal);
		// attempt 0 fails → delay 1000
		await vi.advanceTimersByTimeAsync(1000);
		expect(getCalls()).toBe(2);
		// attempt 1 fails → delay 2000
		await vi.advanceTimersByTimeAsync(2000);
		expect(getCalls()).toBe(3);
		// attempt 2 fails → delay 4000
		await vi.advanceTimersByTimeAsync(4000);
		expect(getCalls()).toBe(4);

		await expect(promise).rejects.toThrow("fail");
	});

	it("uses fixed backoff delays", async () => {
		const { fn, getCalls } = alwaysFails();
		const wrapped = withRetry(fn, {
			maxAttempts: 4,
			backoff: "fixed",
			initialDelayMs: 500,
		});

		const promise = wrapped(new AbortController().signal);
		// All delays should be 500ms
		await vi.advanceTimersByTimeAsync(500);
		expect(getCalls()).toBe(2);
		await vi.advanceTimersByTimeAsync(500);
		expect(getCalls()).toBe(3);
		await vi.advanceTimersByTimeAsync(500);
		expect(getCalls()).toBe(4);

		await expect(promise).rejects.toThrow("fail");
	});

	it("uses linear backoff delays", async () => {
		const { fn, getCalls } = alwaysFails();
		const wrapped = withRetry(fn, {
			maxAttempts: 4,
			backoff: "linear",
			initialDelayMs: 1000,
		});

		const promise = wrapped(new AbortController().signal);
		// attempt 0 fails → delay 1000 * 1 = 1000
		await vi.advanceTimersByTimeAsync(1000);
		expect(getCalls()).toBe(2);
		// attempt 1 fails → delay 1000 * 2 = 2000
		await vi.advanceTimersByTimeAsync(2000);
		expect(getCalls()).toBe(3);
		// attempt 2 fails → delay 1000 * 3 = 3000
		await vi.advanceTimersByTimeAsync(3000);
		expect(getCalls()).toBe(4);

		await expect(promise).rejects.toThrow("fail");
	});

	it("caps delay at maxDelayMs", async () => {
		const { fn, getCalls } = alwaysFails();
		const wrapped = withRetry(fn, {
			maxAttempts: 5,
			backoff: "exponential",
			initialDelayMs: 1000,
			maxDelayMs: 3000,
		});

		const promise = wrapped(new AbortController().signal);
		// attempt 0 → delay 1000
		await vi.advanceTimersByTimeAsync(1000);
		expect(getCalls()).toBe(2);
		// attempt 1 → delay 2000
		await vi.advanceTimersByTimeAsync(2000);
		expect(getCalls()).toBe(3);
		// attempt 2 → delay would be 4000, capped to 3000
		await vi.advanceTimersByTimeAsync(3000);
		expect(getCalls()).toBe(4);
		// attempt 3 → delay would be 8000, capped to 3000
		await vi.advanceTimersByTimeAsync(3000);
		expect(getCalls()).toBe(5);

		await expect(promise).rejects.toThrow("fail");
	});

	it("uses defaults when no policy provided", async () => {
		const { fn, getCalls } = alwaysFails();
		const wrapped = withRetry(fn);

		const promise = wrapped(new AbortController().signal);
		// default: 3 attempts, exponential, 1000ms initial, 30000ms cap
		// attempt 0 → delay 1000
		await vi.advanceTimersByTimeAsync(1000);
		expect(getCalls()).toBe(2);
		// attempt 1 → delay 2000
		await vi.advanceTimersByTimeAsync(2000);
		expect(getCalls()).toBe(3);

		await expect(promise).rejects.toThrow("fail");
	});

	it("maxAttempts: 1 means no retries", async () => {
		const { fn, getCalls } = alwaysFails("once");
		const wrapped = withRetry(fn, { maxAttempts: 1 });

		await expect(wrapped(new AbortController().signal)).rejects.toThrow("once");
		expect(getCalls()).toBe(1);
	});

	it("times out a slow attempt and retries", async () => {
		let calls = 0;
		const fn = async (_signal: AbortSignal) => {
			calls++;
			if (calls === 1) {
				// Hang forever on first attempt — timeout should abort it
				return new Promise<string>((_, reject) => {
					_signal.addEventListener("abort", () => reject(_signal.reason), {
						once: true,
					});
				});
			}
			return "ok";
		};
		const wrapped = withRetry(fn, {
			maxAttempts: 3,
			timeoutMs: 100,
			initialDelayMs: 50,
		});

		const promise = wrapped(new AbortController().signal);
		// Advance past the timeout
		await vi.advanceTimersByTimeAsync(100);
		// Advance past the backoff delay
		await vi.advanceTimersByTimeAsync(50);
		const result = await promise;

		expect(result).toBe("ok");
		expect(calls).toBe(2);
	});

	it("propagates parent abort through timeout child signal", async () => {
		let receivedSignal: AbortSignal | undefined;
		const fn = async (signal: AbortSignal) => {
			receivedSignal = signal;
			return new Promise<string>((_, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			});
		};
		const wrapped = withRetry(fn, {
			maxAttempts: 3,
			timeoutMs: 5000,
		});

		const parent = new AbortController();
		const promise = wrapped(parent.signal);

		// fn should get a child signal, not the parent
		expect(receivedSignal).not.toBe(parent.signal);

		// Aborting the parent should propagate to the child
		parent.abort(new Error("parent abort"));

		await expect(promise).rejects.toThrow("parent abort");
	});

	it("cleans up timeout timer on fast success", async () => {
		const fn = async (_signal: AbortSignal) => "fast";
		const wrapped = withRetry(fn, {
			maxAttempts: 3,
			timeoutMs: 5000,
		});

		await wrapped(new AbortController().signal);

		// If cleanup works, no timers should be pending
		expect(vi.getTimerCount()).toBe(0);
	});

	it("timeout with maxAttempts: 1 throws on timeout", async () => {
		const fn = async (signal: AbortSignal) => {
			return new Promise<string>((_, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
			});
		};
		const wrapped = withRetry(fn, {
			maxAttempts: 1,
			timeoutMs: 100,
		});

		const promise = wrapped(new AbortController().signal);
		await vi.advanceTimersByTimeAsync(100);

		await expect(promise).rejects.toThrow("timeout");
	});
});

describe("calculateDelay", () => {
	it("calculates exponential delay", () => {
		expect(calculateDelay(0, { backoff: "exponential", initialDelayMs: 1000, maxDelayMs: 30000 })).toBe(1000);
		expect(calculateDelay(1, { backoff: "exponential", initialDelayMs: 1000, maxDelayMs: 30000 })).toBe(2000);
		expect(calculateDelay(2, { backoff: "exponential", initialDelayMs: 1000, maxDelayMs: 30000 })).toBe(4000);
	});

	it("calculates fixed delay", () => {
		expect(calculateDelay(0, { backoff: "fixed", initialDelayMs: 500, maxDelayMs: 30000 })).toBe(500);
		expect(calculateDelay(5, { backoff: "fixed", initialDelayMs: 500, maxDelayMs: 30000 })).toBe(500);
	});

	it("calculates linear delay", () => {
		expect(calculateDelay(0, { backoff: "linear", initialDelayMs: 1000, maxDelayMs: 30000 })).toBe(1000);
		expect(calculateDelay(1, { backoff: "linear", initialDelayMs: 1000, maxDelayMs: 30000 })).toBe(2000);
		expect(calculateDelay(2, { backoff: "linear", initialDelayMs: 1000, maxDelayMs: 30000 })).toBe(3000);
	});

	it("caps at maxDelayMs", () => {
		expect(calculateDelay(10, { backoff: "exponential", initialDelayMs: 1000, maxDelayMs: 5000 })).toBe(5000);
	});
});

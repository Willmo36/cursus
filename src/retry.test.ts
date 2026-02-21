// ABOUTME: Tests for activity wrappers: withRetry, withCircuitBreaker, and wrapActivity.
// ABOUTME: Covers retry behavior, circuit breaker state transitions, wrapper composition, and defaults.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CircuitOpenError,
	calculateDelay,
	withCircuitBreaker,
	withRetry,
	wrapActivity,
} from "./retry";

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
});

describe("calculateDelay", () => {
	it("calculates exponential delay", () => {
		expect(
			calculateDelay(0, {
				backoff: "exponential",
				initialDelayMs: 1000,
				maxDelayMs: 30000,
			}),
		).toBe(1000);
		expect(
			calculateDelay(1, {
				backoff: "exponential",
				initialDelayMs: 1000,
				maxDelayMs: 30000,
			}),
		).toBe(2000);
		expect(
			calculateDelay(2, {
				backoff: "exponential",
				initialDelayMs: 1000,
				maxDelayMs: 30000,
			}),
		).toBe(4000);
	});

	it("calculates fixed delay", () => {
		expect(
			calculateDelay(0, {
				backoff: "fixed",
				initialDelayMs: 500,
				maxDelayMs: 30000,
			}),
		).toBe(500);
		expect(
			calculateDelay(5, {
				backoff: "fixed",
				initialDelayMs: 500,
				maxDelayMs: 30000,
			}),
		).toBe(500);
	});

	it("calculates linear delay", () => {
		expect(
			calculateDelay(0, {
				backoff: "linear",
				initialDelayMs: 1000,
				maxDelayMs: 30000,
			}),
		).toBe(1000);
		expect(
			calculateDelay(1, {
				backoff: "linear",
				initialDelayMs: 1000,
				maxDelayMs: 30000,
			}),
		).toBe(2000);
		expect(
			calculateDelay(2, {
				backoff: "linear",
				initialDelayMs: 1000,
				maxDelayMs: 30000,
			}),
		).toBe(3000);
	});

	it("caps at maxDelayMs", () => {
		expect(
			calculateDelay(10, {
				backoff: "exponential",
				initialDelayMs: 1000,
				maxDelayMs: 5000,
			}),
		).toBe(5000);
	});
});

describe("withCircuitBreaker", () => {
	it("passes through calls in closed state", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			return "ok";
		};
		const wrapped = withCircuitBreaker(fn);
		const result = await wrapped(new AbortController().signal);
		expect(result).toBe("ok");
		expect(calls).toBe(1);
	});

	it("passes AbortSignal through to inner function", async () => {
		let receivedSignal: AbortSignal | undefined;
		const fn = async (signal: AbortSignal) => {
			receivedSignal = signal;
			return "ok";
		};
		const wrapped = withCircuitBreaker(fn);
		const controller = new AbortController();
		await wrapped(controller.signal);
		expect(receivedSignal).toBe(controller.signal);
	});

	it("opens after failureThreshold consecutive failures", async () => {
		const { fn } = alwaysFails();
		const wrapped = withCircuitBreaker(fn, { failureThreshold: 3 });
		const signal = new AbortController().signal;

		// 3 failures to hit threshold
		for (let i = 0; i < 3; i++) {
			await expect(wrapped(signal)).rejects.toThrow("fail");
		}

		// Next call should be CircuitOpenError (not calling fn)
		await expect(wrapped(signal)).rejects.toThrow(CircuitOpenError);
	});

	it("rejects with CircuitOpenError when open without calling fn", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			throw new Error("fail");
		};
		const wrapped = withCircuitBreaker(fn, { failureThreshold: 2 });
		const signal = new AbortController().signal;

		// Trip the breaker
		await expect(wrapped(signal)).rejects.toThrow("fail");
		await expect(wrapped(signal)).rejects.toThrow("fail");
		expect(calls).toBe(2);

		// Now open — should not call fn
		await expect(wrapped(signal)).rejects.toThrow(CircuitOpenError);
		expect(calls).toBe(2);
	});

	it("transitions to half-open after resetTimeoutMs", async () => {
		const { fn, getCalls } = alwaysFails();
		const wrapped = withCircuitBreaker(fn, {
			failureThreshold: 2,
			resetTimeoutMs: 5000,
		});
		const signal = new AbortController().signal;

		// Trip the breaker
		await expect(wrapped(signal)).rejects.toThrow("fail");
		await expect(wrapped(signal)).rejects.toThrow("fail");

		// Advance past reset timeout
		await vi.advanceTimersByTimeAsync(5001);

		// Should attempt the call (half-open), not reject with CircuitOpenError
		await expect(wrapped(signal)).rejects.toThrow("fail");
		expect(getCalls()).toBe(3);
	});

	it("closes on successful half-open probe", async () => {
		let calls = 0;
		let shouldFail = true;
		const fn = async () => {
			calls++;
			if (shouldFail) throw new Error("fail");
			return "ok";
		};
		const wrapped = withCircuitBreaker(fn, {
			failureThreshold: 2,
			resetTimeoutMs: 5000,
		});
		const signal = new AbortController().signal;

		// Trip the breaker
		await expect(wrapped(signal)).rejects.toThrow("fail");
		await expect(wrapped(signal)).rejects.toThrow("fail");

		// Advance past reset timeout
		await vi.advanceTimersByTimeAsync(5001);

		// Fix the function, then probe succeeds
		shouldFail = false;
		const result = await wrapped(signal);
		expect(result).toBe("ok");

		// Circuit should be closed now — further calls go through
		const result2 = await wrapped(signal);
		expect(result2).toBe("ok");
		expect(calls).toBe(4);
	});

	it("re-opens on failed half-open probe", async () => {
		const { fn, getCalls } = alwaysFails();
		const wrapped = withCircuitBreaker(fn, {
			failureThreshold: 2,
			resetTimeoutMs: 5000,
		});
		const signal = new AbortController().signal;

		// Trip the breaker
		await expect(wrapped(signal)).rejects.toThrow("fail");
		await expect(wrapped(signal)).rejects.toThrow("fail");

		// Advance past reset timeout → half-open
		await vi.advanceTimersByTimeAsync(5001);

		// Probe fails → back to open
		await expect(wrapped(signal)).rejects.toThrow("fail");
		expect(getCalls()).toBe(3);

		// Should be open again
		await expect(wrapped(signal)).rejects.toThrow(CircuitOpenError);
		expect(getCalls()).toBe(3);
	});

	it("resets failure count on success in closed state", async () => {
		let calls = 0;
		let failNext = false;
		const fn = async () => {
			calls++;
			if (failNext) throw new Error("fail");
			return "ok";
		};
		const wrapped = withCircuitBreaker(fn, { failureThreshold: 3 });
		const signal = new AbortController().signal;

		// 2 failures (not enough to trip)
		failNext = true;
		await expect(wrapped(signal)).rejects.toThrow("fail");
		await expect(wrapped(signal)).rejects.toThrow("fail");

		// 1 success resets counter
		failNext = false;
		await wrapped(signal);

		// 2 more failures — still not tripped because counter was reset
		failNext = true;
		await expect(wrapped(signal)).rejects.toThrow("fail");
		await expect(wrapped(signal)).rejects.toThrow("fail");

		// Not yet at threshold — should still call fn
		await expect(wrapped(signal)).rejects.toThrow("fail");
		expect(calls).toBe(6);

		// NOW it should be open
		await expect(wrapped(signal)).rejects.toThrow(CircuitOpenError);
	});

	it("uses defaults when no policy provided", async () => {
		const { fn } = alwaysFails();
		const wrapped = withCircuitBreaker(fn);
		const signal = new AbortController().signal;

		// Default failureThreshold is 5
		for (let i = 0; i < 5; i++) {
			await expect(wrapped(signal)).rejects.toThrow("fail");
		}
		await expect(wrapped(signal)).rejects.toThrow(CircuitOpenError);

		// Default resetTimeoutMs is 30000
		await vi.advanceTimersByTimeAsync(29999);
		await expect(wrapped(signal)).rejects.toThrow(CircuitOpenError);

		await vi.advanceTimersByTimeAsync(2);
		// Should be half-open now — calls fn
		await expect(wrapped(signal)).rejects.toThrow("fail");
	});

	it("throws CircuitOpenError in open state regardless of signal", async () => {
		const { fn } = alwaysFails();
		const wrapped = withCircuitBreaker(fn, { failureThreshold: 2 });

		// Trip the breaker
		const signal = new AbortController().signal;
		await expect(wrapped(signal)).rejects.toThrow("fail");
		await expect(wrapped(signal)).rejects.toThrow("fail");

		// Open: even with a fresh signal, should get CircuitOpenError
		const controller = new AbortController();
		const err = await wrapped(controller.signal).catch((e) => e);
		expect(err).toBeInstanceOf(CircuitOpenError);
	});
});

describe("wrapActivity", () => {
	it("single wrapper behaves same as calling wrapper directly", async () => {
		let calls = 0;
		const fn = async () => {
			calls++;
			return "ok";
		};
		const wrapper = (f: typeof fn) => withRetry(f, { maxAttempts: 1 });
		const wrapped = wrapActivity(wrapper)(fn);
		const result = await wrapped(new AbortController().signal);
		expect(result).toBe("ok");
		expect(calls).toBe(1);
	});

	it("two wrappers compose correctly (outer wraps inner)", async () => {
		const order: string[] = [];
		const outerWrapper = <T>(f: (signal: AbortSignal) => Promise<T>) => {
			return async (signal: AbortSignal) => {
				order.push("outer-before");
				const result = await f(signal);
				order.push("outer-after");
				return result;
			};
		};
		const innerWrapper = <T>(f: (signal: AbortSignal) => Promise<T>) => {
			return async (signal: AbortSignal) => {
				order.push("inner-before");
				const result = await f(signal);
				order.push("inner-after");
				return result;
			};
		};

		const fn = async () => "ok";
		const wrapped = wrapActivity(outerWrapper, innerWrapper)(fn);
		const result = await wrapped(new AbortController().signal);

		expect(result).toBe("ok");
		expect(order).toEqual([
			"outer-before",
			"inner-before",
			"inner-after",
			"outer-after",
		]);
	});

	it("empty wrappers list returns identity function", async () => {
		let calls = 0;
		const fn = async (_signal: AbortSignal) => {
			calls++;
			return "identity";
		};
		const wrapped = wrapActivity()(fn);
		const result = await wrapped(new AbortController().signal);
		expect(result).toBe("identity");
		expect(calls).toBe(1);
	});

	it("three wrappers compose associatively", async () => {
		const order: string[] = [];
		const makeWrapper = (name: string) => {
			return <T>(f: (signal: AbortSignal) => Promise<T>) => {
				return async (signal: AbortSignal) => {
					order.push(`${name}-before`);
					const result = await f(signal);
					order.push(`${name}-after`);
					return result;
				};
			};
		};

		const a = makeWrapper("a");
		const b = makeWrapper("b");
		const c = makeWrapper("c");

		const fn = async () => "ok";

		// wrapActivity(a, b, c) should equal wrapActivity(a, wrapActivity(b, c))
		const wrapped1 = wrapActivity(a, b, c)(fn);
		await wrapped1(new AbortController().signal);
		const order1 = [...order];

		order.length = 0;
		const wrapped2 = wrapActivity(a, wrapActivity(b, c))(fn);
		await wrapped2(new AbortController().signal);
		const order2 = [...order];

		expect(order1).toEqual(order2);
		expect(order1).toEqual([
			"a-before",
			"b-before",
			"c-before",
			"c-after",
			"b-after",
			"a-after",
		]);
	});
});

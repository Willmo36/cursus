// ABOUTME: Tests for the useWorkflow React hook.
// ABOUTME: Covers initial state, completion, signals, reset, replay, and waiting state.

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";
import { useWorkflow } from "./use-workflow";

describe("useWorkflow", () => {
	it("starts with running state and completes", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const { result } = renderHook(() =>
			useWorkflow("test-1", workflow, { storage: new MemoryStorage() }),
		);

		// Initial synchronous state is "running"
		expect(result.current.state).toBe("running");
		expect(result.current.result).toBeUndefined();

		// Wait for the workflow to finish so no state updates leak
		await waitFor(() => {
			expect(result.current.state).toBe("completed");
		});
	});

	it("completes and returns the result", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const { result } = renderHook(() =>
			useWorkflow("test-2", workflow, { storage: new MemoryStorage() }),
		);

		await waitFor(() => {
			expect(result.current.state).toBe("completed");
			expect(result.current.result).toBe("hello");
		});
	});

	it("provides signal function that pushes data into workflow", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const data = yield* ctx.waitFor<string>("submit");
			return `got: ${data}`;
		};

		const { result } = renderHook(() =>
			useWorkflow("test-3", workflow, { storage: new MemoryStorage() }),
		);

		await waitFor(() => {
			expect(result.current.state).toBe("waiting");
			expect(result.current.waitingFor).toBe("submit");
		});

		act(() => {
			result.current.signal("submit", "form-data");
		});

		await waitFor(() => {
			expect(result.current.state).toBe("completed");
			expect(result.current.result).toBe("got: form-data");
		});
	});

	it("resets clears storage and restarts the workflow", async () => {
		let callCount = 0;
		const workflow: WorkflowFunction<number> = function* (ctx) {
			callCount++;
			return yield* ctx.activity("count", async () => callCount);
		};

		const storage = new MemoryStorage();
		const { result } = renderHook(() =>
			useWorkflow("test-4", workflow, { storage }),
		);

		await waitFor(() => {
			expect(result.current.state).toBe("completed");
			expect(result.current.result).toBe(1);
		});

		await act(async () => {
			result.current.reset();
		});

		await waitFor(() => {
			expect(result.current.state).toBe("completed");
			expect(result.current.result).toBe(2);
		});
	});

	it("resumes from storage on remount (replay)", async () => {
		const activityFn = vi.fn().mockResolvedValue("hello");
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", activityFn);
		};

		const storage = new MemoryStorage();

		// First mount: runs the workflow live
		const { result: result1, unmount } = renderHook(() =>
			useWorkflow("test-5", workflow, { storage }),
		);

		await waitFor(() => {
			expect(result1.current.state).toBe("completed");
		});

		expect(activityFn).toHaveBeenCalledTimes(1);
		unmount();

		// Second mount: replays from storage
		const { result: result2 } = renderHook(() =>
			useWorkflow("test-5", workflow, { storage }),
		);

		await waitFor(() => {
			expect(result2.current.state).toBe("completed");
			expect(result2.current.result).toBe("hello");
		});

		// Activity should not be called again on replay
		expect(activityFn).toHaveBeenCalledTimes(1);
	});

	it("exposes what signal the workflow is waiting for", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const email = yield* ctx.waitFor<string>("email");
			const password = yield* ctx.waitFor<string>("password");
			return `${email}:${password}`;
		};

		const { result } = renderHook(() =>
			useWorkflow("test-6", workflow, { storage: new MemoryStorage() }),
		);

		await waitFor(() => {
			expect(result.current.state).toBe("waiting");
			expect(result.current.waitingFor).toBe("email");
		});
	});

	it("persists events incrementally so intermediate state survives remount", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const email = yield* ctx.waitFor<string>("email");
			const password = yield* ctx.waitFor<string>("password");
			return `${email}:${password}`;
		};

		const storage = new MemoryStorage();

		// First mount: send the first signal
		const { result: result1, unmount } = renderHook(() =>
			useWorkflow("test-7", workflow, { storage }),
		);

		await waitFor(() => {
			expect(result1.current.waitingFor).toBe("email");
		});

		act(() => {
			result1.current.signal("email", "max@test.com");
		});

		await waitFor(() => {
			expect(result1.current.waitingFor).toBe("password");
		});

		unmount();

		// Events should be persisted after the signal
		const events = await storage.load("test-7");
		expect(events.length).toBeGreaterThan(0);

		// Second mount: should replay to the password step
		const { result: result2 } = renderHook(() =>
			useWorkflow("test-7", workflow, { storage }),
		);

		await waitFor(() => {
			expect(result2.current.state).toBe("waiting");
			expect(result2.current.waitingFor).toBe("password");
		});
	});
});

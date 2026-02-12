// ABOUTME: Tests for the useWorkflow React hook.
// ABOUTME: Covers initial state, completion, signals, reset, replay, and waiting state.

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkflowRegistryProvider } from "./registry-provider";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";
import { useGlobalWorkflow } from "./use-global-workflow";
import { useWorkflow } from "./use-workflow";
import { useWorkflowEvents } from "./use-workflow-events";

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

	it("collects multiple signals with waitAll", async () => {
		const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
			return yield* ctx.waitAll("email", "password");
		};

		const { result } = renderHook(() =>
			useWorkflow("test-waitall", workflow, {
				storage: new MemoryStorage(),
			}),
		);

		await waitFor(() => {
			expect(result.current.state).toBe("waiting");
		});

		act(() => {
			result.current.signal("email", "a@b.com");
		});

		// Should still be waiting for password
		await waitFor(() => {
			expect(result.current.state).toBe("waiting");
		});

		act(() => {
			result.current.signal("password", "secret");
		});

		await waitFor(() => {
			expect(result.current.state).toBe("completed");
			expect(result.current.result).toEqual(["a@b.com", "secret"]);
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

	it("signal then waitForWorkflow then activity completes", async () => {
		const profileWorkflow: WorkflowFunction<{ name: string }> = function* (
			ctx,
		) {
			const profile = yield* ctx.waitFor<{ name: string }>("profile");
			return profile;
		};

		const checkoutWorkflow: WorkflowFunction<string> = function* (ctx) {
			const payment = yield* ctx.waitFor<string>("payment");
			const profile = yield* ctx.waitForWorkflow<{ name: string }>("profile");
			const order = yield* ctx.activity("place-order", async () => {
				return `${profile.name}:${payment}`;
			});
			return order;
		};

		const storage = new MemoryStorage();
		const workflows = { profile: profileWorkflow };

		const wrapper = ({ children }: { children: React.ReactNode }) =>
			createElement(WorkflowRegistryProvider, { workflows, storage }, children);

		const { result } = renderHook(
			() => ({
				checkout: useWorkflow("checkout", checkoutWorkflow, { storage }),
				profile: useGlobalWorkflow("profile"),
			}),
			{ wrapper },
		);

		// Profile should be waiting for "profile" signal
		await waitFor(() => {
			expect(result.current.profile.state).toBe("waiting");
			expect(result.current.profile.waitingFor).toBe("profile");
		});

		// Checkout should be waiting for "payment" signal
		await waitFor(() => {
			expect(result.current.checkout.state).toBe("waiting");
			expect(result.current.checkout.waitingFor).toBe("payment");
		});

		// Send profile signal first
		act(() => {
			result.current.profile.signal("profile", { name: "Max" });
		});

		await waitFor(() => {
			expect(result.current.profile.state).toBe("completed");
		});

		// Send payment signal
		act(() => {
			result.current.checkout.signal("payment", "1234");
		});

		// Checkout should complete after waitForWorkflow resolves and activity runs
		await waitFor(() => {
			expect(result.current.checkout.state).toBe("completed");
			expect(result.current.checkout.result).toBe("Max:1234");
		});
	});

	it("local workflow events appear in useWorkflowEvents when inside a provider", async () => {
		const globalWorkflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("greet", async () => "hello");
		};

		const localWorkflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("compute", async () => "result");
		};

		const storage = new MemoryStorage();
		const workflows = { global: globalWorkflow };

		const wrapper = ({ children }: { children: ReactNode }) =>
			createElement(WorkflowRegistryProvider, { workflows, storage }, children);

		const { result } = renderHook(
			() => ({
				local: useWorkflow("local", localWorkflow, { storage }),
				global: useGlobalWorkflow("global"),
				events: useWorkflowEvents(),
			}),
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.local.state).toBe("completed");
			expect(result.current.global.state).toBe("completed");
		});

		await waitFor(() => {
			const ids = result.current.events.map((e) => e.id);
			expect(ids).toContain("global");
			expect(ids).toContain("local");

			const localLog = result.current.events.find((e) => e.id === "local");
			expect(localLog?.events[0]).toMatchObject({ type: "workflow_started" });
			expect(localLog?.events).toContainEqual(
				expect.objectContaining({ type: "workflow_completed" }),
			);
		});
	});

	it("useWorkflow inside provider can use waitForWorkflow", async () => {
		const loginWorkflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("login", async () => "user-123");
		};

		const localWorkflow: WorkflowFunction<string> = function* (ctx) {
			const user = yield* ctx.waitForWorkflow<string>("login");
			return `local got: ${user}`;
		};

		const storage = new MemoryStorage();
		const workflows = { login: loginWorkflow };

		const wrapper = ({ children }: { children: React.ReactNode }) =>
			createElement(WorkflowRegistryProvider, { workflows, storage }, children);

		const { result } = renderHook(
			() => useWorkflow("local", localWorkflow, { storage }),
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.state).toBe("completed");
			expect(result.current.result).toBe("local got: user-123");
		});
	});
});

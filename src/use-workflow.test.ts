// ABOUTME: Tests for the useWorkflow React hook.
// ABOUTME: Covers inline workflows, layer workflows, signals, reset, replay, and waiting state.

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createLayer } from "./layer";
import { WorkflowLayerProvider } from "./layer-provider";
import { MemoryStorage } from "./storage";
import type { WorkflowFunction } from "./types";
import { useWorkflow } from "./use-workflow";
import { useWorkflowEvents } from "./use-workflow-events";

describe("useWorkflow", () => {
	describe("inline mode (with workflowFn)", () => {
		it("starts with running state and completes", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const { result } = renderHook(() =>
				useWorkflow("test-1", workflow, { storage: new MemoryStorage() }),
			);

			expect(result.current.state).toBe("running");
			expect(result.current.result).toBeUndefined();

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

			const { result: result1, unmount } = renderHook(() =>
				useWorkflow("test-5", workflow, { storage }),
			);

			await waitFor(() => {
				expect(result1.current.state).toBe("completed");
			});

			expect(activityFn).toHaveBeenCalledTimes(1);
			unmount();

			const { result: result2 } = renderHook(() =>
				useWorkflow("test-5", workflow, { storage }),
			);

			await waitFor(() => {
				expect(result2.current.state).toBe("completed");
				expect(result2.current.result).toBe("hello");
			});

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

			const events = await storage.load("test-7");
			expect(events.length).toBeGreaterThan(0);

			const { result: result2 } = renderHook(() =>
				useWorkflow("test-7", workflow, { storage }),
			);

			await waitFor(() => {
				expect(result2.current.state).toBe("waiting");
				expect(result2.current.waitingFor).toBe("password");
			});
		});
	});

	describe("layer mode (without workflowFn)", () => {
		it("auto-starts the layer workflow on mount", async () => {
			let started = false;
			const workflow: WorkflowFunction<string> = function* (ctx) {
				started = true;
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ greet: workflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			renderHook(() => useWorkflow("greet"), { wrapper });

			await waitFor(() => {
				expect(started).toBe(true);
			});
		});

		it("returns completed state and result", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ greet: workflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(() => useWorkflow<string>("greet"), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
				expect(result.current.result).toBe("hello");
			});
		});

		it("sends signals to the layer workflow", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ form: workflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(() => useWorkflow("form"), {
				wrapper,
			});

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

		it("state reactively updates as layer workflow progresses", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const a = yield* ctx.waitFor<string>("step1");
				const b = yield* ctx.waitFor<string>("step2");
				return `${a}:${b}`;
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ multi: workflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(() => useWorkflow("multi"), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current.waitingFor).toBe("step1");
			});

			act(() => {
				result.current.signal("step1", "val1");
			});

			await waitFor(() => {
				expect(result.current.waitingFor).toBe("step2");
			});

			act(() => {
				result.current.signal("step2", "val2");
			});

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
				expect(result.current.result).toBe("val1:val2");
			});
		});

		it("throws when used outside a provider", () => {
			expect(() => {
				renderHook(() => useWorkflow("anything"));
			}).toThrow(/WorkflowLayerProvider/);
		});
	});

	describe("cross-workflow dependencies", () => {
		it("inline workflow can use waitForWorkflow with layer workflows", async () => {
			const loginWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("login", async () => "user-123");
			};

			const localWorkflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				const user = yield* ctx.waitForWorkflow("login");
				return `local got: ${user}`;
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ login: loginWorkflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(
				() => useWorkflow("local", localWorkflow, { storage }),
				{ wrapper },
			);

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
				expect(result.current.result).toBe("local got: user-123");
			});
		});

		it("signal then waitForWorkflow then activity completes", async () => {
			const profileWorkflow: WorkflowFunction<{ name: string }> = function* (
				ctx,
			) {
				const profile = yield* ctx.waitFor<{ name: string }>("profile");
				return profile;
			};

			const checkoutWorkflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ profile: { name: string } }
			> = function* (ctx) {
				const payment = yield* ctx.waitFor("payment");
				const profile = yield* ctx.waitForWorkflow("profile");
				const order = yield* ctx.activity("place-order", async () => {
					return `${profile.name}:${payment}`;
				});
				return order;
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ profile: profileWorkflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(
				() => ({
					checkout: useWorkflow("checkout", checkoutWorkflow, { storage }),
					profile: useWorkflow("profile"),
				}),
				{ wrapper },
			);

			await waitFor(() => {
				expect(result.current.profile.state).toBe("waiting");
				expect(result.current.profile.waitingFor).toBe("profile");
			});

			await waitFor(() => {
				expect(result.current.checkout.state).toBe("waiting");
				expect(result.current.checkout.waitingFor).toBe("payment");
			});

			act(() => {
				result.current.profile.signal("profile", { name: "Max" });
			});

			await waitFor(() => {
				expect(result.current.profile.state).toBe("completed");
			});

			act(() => {
				result.current.checkout.signal("payment", "1234");
			});

			await waitFor(() => {
				expect(result.current.checkout.state).toBe("completed");
				expect(result.current.checkout.result).toBe("Max:1234");
			});
		});

		it("debug panel shows all events for waitAll with signal + workflow dep", async () => {
			const profileWorkflow: WorkflowFunction<{ name: string }> = function* (
				ctx,
			) {
				const profile = yield* ctx.waitFor<{ name: string }>("profile");
				return profile;
			};

			const checkoutWf: WorkflowFunction<
				string,
				{ payment: string },
				{ profile: { name: string } }
			> = function* (ctx) {
				const [payment, profile] = yield* ctx.waitAll(
					"payment",
					ctx.workflow("profile"),
				);
				const order = yield* ctx.activity("place-order", async () => {
					return `${profile.name}:${payment}`;
				});
				return order;
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ profile: profileWorkflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(
					StrictMode,
					null,
					createElement(WorkflowLayerProvider, { layer }, children),
				);

			const { result } = renderHook(
				() => ({
					checkout: useWorkflow("checkout", checkoutWf, { storage }),
					profile: useWorkflow("profile"),
					events: useWorkflowEvents(),
				}),
				{ wrapper },
			);

			// Wait for profile to be waiting for signal
			await waitFor(() => {
				expect(result.current.profile.waitingFor).toBe("profile");
			});

			// Wait for checkout to be waiting (waitAll)
			await waitFor(() => {
				expect(result.current.checkout.state).toBe("waiting");
			});

			// Send profile signal — profile completes, checkout still waiting for payment
			act(() => {
				result.current.profile.signal("profile", { name: "Max" });
			});

			await waitFor(() => {
				expect(result.current.profile.state).toBe("completed");
			});

			// Send payment signal — checkout should complete
			act(() => {
				result.current.checkout.signal("payment", "1234");
			});

			await waitFor(() => {
				expect(result.current.checkout.state).toBe("completed");
				expect(result.current.checkout.result).toBe("Max:1234");
			});

			// Now check that the debug panel shows ALL checkout events
			await waitFor(() => {
				const checkoutLog = result.current.events.find(
					(e) => e.id === "checkout",
				);
				expect(checkoutLog).toBeDefined();
				const types = checkoutLog?.events.map((e) => e.type);
				expect(types).toContain("workflow_started");
				expect(types).toContain("wait_all_started");
				expect(types).toContain("signal_received");
				expect(types).toContain("wait_all_completed");
				expect(types).toContain("activity_scheduled");
				expect(types).toContain("activity_completed");
				expect(types).toContain("workflow_completed");
			});
		});

		it("local workflow events appear in useWorkflowEvents", async () => {
			const globalWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const localWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("compute", async () => "result");
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ global: globalWorkflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(
				() => ({
					local: useWorkflow("local", localWorkflow, { storage }),
					global: useWorkflow("global"),
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
				expect(localLog?.events[0]).toMatchObject({
					type: "workflow_started",
				});
				expect(localLog?.events).toContainEqual(
					expect.objectContaining({ type: "workflow_completed" }),
				);
			});
		});
	});
});

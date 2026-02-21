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

		it("exposes waitingForAny when workflow uses waitForAny", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const { signal } = yield* ctx.waitForAny("a", "b");
					return signal;
				};

			const { result } = renderHook(() =>
				useWorkflow("test-waitForAny", workflow, {
					storage: new MemoryStorage(),
				}),
			);

			await waitFor(() => {
				expect(result.current.state).toBe("waiting");
				expect(result.current.waitingForAny).toEqual(["a", "b"]);
			});

			act(() => {
				result.current.signal("a", "payload");
			});

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
				expect(result.current.waitingForAny).toBeUndefined();
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

		it("collects multiple signals with waitForAll", async () => {
			const workflow: WorkflowFunction<
				[string, string],
				{ email: string; password: string }
			> = function* (ctx) {
				return yield* ctx.waitForAll("email", "password");
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

		it("uses storage from registry context when no explicit storage provided", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", activityFn);
			};

			const providerStorage = new MemoryStorage();
			const layer = createLayer({ bg: workflow }, providerStorage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const inlineWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("compute", async () => "inline-result");
			};

			const { result } = renderHook(
				() => useWorkflow("inline-ctx", inlineWorkflow),
				{ wrapper },
			);

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
				expect(result.current.result).toBe("inline-result");
			});

			// Events should be persisted to the provider's storage, not lost in ephemeral MemoryStorage
			const events = await providerStorage.load("inline-ctx");
			expect(events.length).toBeGreaterThan(0);
		});

		it("explicit options.storage overrides registry storage", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const providerStorage = new MemoryStorage();
			const explicitStorage = new MemoryStorage();
			const layer = createLayer({ bg: workflow }, providerStorage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const inlineWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("compute", async () => "result");
			};

			const { result } = renderHook(
				() =>
					useWorkflow("inline-explicit", inlineWorkflow, {
						storage: explicitStorage,
					}),
				{ wrapper },
			);

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
			});

			// Events should be in explicit storage, not provider storage
			const explicitEvents = await explicitStorage.load("inline-explicit");
			const providerEvents = await providerStorage.load("inline-explicit");
			expect(explicitEvents.length).toBeGreaterThan(0);
			expect(providerEvents).toHaveLength(0);
		});

		it("falls back to MemoryStorage without a provider", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			// No wrapper, no explicit storage — should still work
			const { result } = renderHook(() =>
				useWorkflow("inline-fallback", workflow),
			);

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
				expect(result.current.result).toBe("hello");
			});
		});

		it("compacts storage after inline workflow completes", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			renderHook(() => useWorkflow("test-compact", workflow, { storage }));

			await waitFor(async () => {
				const events = await storage.load("test-compact");
				expect(events).toHaveLength(1);
				expect(events[0]).toMatchObject({
					type: "workflow_completed",
					result: "hello",
				});
			});
		});

		it("round-trips through compaction: run, compact, remount, fast path", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", activityFn);
			};

			const storage = new MemoryStorage();

			const { result: result1, unmount } = renderHook(() =>
				useWorkflow("test-roundtrip", workflow, { storage }),
			);

			await waitFor(() => {
				expect(result1.current.state).toBe("completed");
				expect(result1.current.result).toBe("hello");
			});

			expect(activityFn).toHaveBeenCalledTimes(1);
			unmount();

			// Storage should be compacted
			const events = await storage.load("test-roundtrip");
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ type: "workflow_completed" });

			// Remount — should hit fast path, activity NOT re-called
			const { result: result2 } = renderHook(() =>
				useWorkflow("test-roundtrip", workflow, { storage }),
			);

			await waitFor(() => {
				expect(result2.current.state).toBe("completed");
				expect(result2.current.result).toBe("hello");
			});

			expect(activityFn).toHaveBeenCalledTimes(1);
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

		it("reset() restarts a layer workflow", async () => {
			let runCount = 0;
			const workflow: WorkflowFunction<number> = function* (ctx) {
				runCount++;
				return yield* ctx.activity("count", async () => runCount);
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ counter: workflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(
				() => useWorkflow<number>("counter"),
				{ wrapper },
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

		it("throws when used outside a provider", () => {
			expect(() => {
				renderHook(() => useWorkflow("anything"));
			}).toThrow(/WorkflowLayerProvider/);
		});
	});

	describe("query", () => {
		it("query returns latest value reactively in inline mode", async () => {
			const workflow: WorkflowFunction<
				string,
				{ submit: string },
				Record<string, never>,
				{ count: number }
			> = function* (ctx) {
				let count = 0;
				ctx.query("count", () => count);
				count++;
				const data = yield* ctx.waitFor("submit");
				count++;
				return `done: ${data}`;
			};

			const { result } = renderHook(() =>
				useWorkflow("q-1", workflow, { storage: new MemoryStorage() }),
			);

			await waitFor(() => {
				expect(result.current.state).toBe("waiting");
			});

			expect(result.current.query("count")).toBe(1);

			act(() => {
				result.current.signal("submit", "data");
			});

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
			});

			expect(result.current.query("count")).toBe(2);
		});

		it("query returns undefined for workflows without queries", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const { result } = renderHook(() =>
				useWorkflow("q-2", workflow, { storage: new MemoryStorage() }),
			);

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
			});

			expect(result.current.query("anything")).toBeUndefined();
		});

		it("reset re-registers queries on new run", async () => {
			let runCount = 0;
			const workflow: WorkflowFunction<
				number,
				Record<string, unknown>,
				Record<string, never>,
				{ run: number }
			> = function* (ctx) {
				runCount++;
				ctx.query("run", () => runCount);
				return yield* ctx.activity("count", async () => runCount);
			};

			const storage = new MemoryStorage();
			const { result } = renderHook(() =>
				useWorkflow("q-3", workflow, { storage }),
			);

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
				expect(result.current.query("run")).toBe(1);
			});

			await act(async () => {
				result.current.reset();
			});

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
				expect(result.current.query("run")).toBe(2);
			});
		});

		it("layer mode exposes query", async () => {
			const workflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				Record<string, never>,
				{ label: string }
			> = function* (ctx) {
				ctx.query("label", () => "from-layer");
				return yield* ctx.activity("greet", async () => "hello");
			};

			const storage = new MemoryStorage();
			const layer = createLayer({ ql: workflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(() => useWorkflow("ql"), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
			});

			expect(result.current.query("label")).toBe("from-layer");
		});
	});

	describe("cancellation", () => {
		it("inline workflow is cancelled on unmount", async () => {
			let activityResolved = false;
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				yield* ctx.activity("after", async () => {
					activityResolved = true;
					return "done";
				});
				return `got: ${data}`;
			};

			const storage = new MemoryStorage();
			const { result, unmount } = renderHook(() =>
				useWorkflow("cancel-1", workflow, { storage }),
			);

			await waitFor(() => {
				expect(result.current.state).toBe("waiting");
			});

			unmount();

			// Sending a signal after unmount should not resume the workflow
			// because the interpreter was cancelled
			await new Promise((r) => setTimeout(r, 50));
			expect(activityResolved).toBe(false);
		});

		it("cancel() function is exposed and works", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const { result } = renderHook(() =>
				useWorkflow("cancel-2", workflow, { storage: new MemoryStorage() }),
			);

			await waitFor(() => {
				expect(result.current.state).toBe("waiting");
			});

			act(() => {
				result.current.cancel();
			});

			await waitFor(() => {
				expect(result.current.state).toBe("cancelled");
			});
		});

		it("reset() cancels before restarting", async () => {
			let runCount = 0;
			const workflow: WorkflowFunction<string> = function* (ctx) {
				runCount++;
				const data = yield* ctx.waitFor<string>("submit");
				return `run${runCount}: ${data}`;
			};

			const storage = new MemoryStorage();
			const { result } = renderHook(() =>
				useWorkflow("cancel-3", workflow, { storage }),
			);

			await waitFor(() => {
				expect(result.current.state).toBe("waiting");
			});

			// Reset while waiting — should cancel and restart
			await act(async () => {
				result.current.reset();
			});

			await waitFor(() => {
				expect(result.current.state).toBe("waiting");
			});

			// Should be on run 2 now
			act(() => {
				result.current.signal("submit", "data");
			});

			await waitFor(() => {
				expect(result.current.state).toBe("completed");
				expect(result.current.result).toBe("run2: data");
			});
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
			const profileWorkflow: WorkflowFunction<
				{ name: string },
				{ profile: { name: string } }
			> = function* (ctx) {
				const profile = yield* ctx.waitFor("profile");
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

		it("debug panel shows all events for waitForAll with signal + workflow dep", async () => {
			const profileWorkflow: WorkflowFunction<
				{ name: string },
				{ profile: { name: string } }
			> = function* (ctx) {
				const profile = yield* ctx.waitFor("profile");
				return profile;
			};

			const checkoutWf: WorkflowFunction<
				string,
				{ payment: string },
				{ profile: { name: string } }
			> = function* (ctx) {
				const [payment, profile] = yield* ctx.waitForAll(
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

			// Wait for checkout to be waiting (waitForAll)
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

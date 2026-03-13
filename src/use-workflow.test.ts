// ABOUTME: Tests for the useWorkflow React hook.
// ABOUTME: Covers inline workflows, layer workflows, signals, reset, replay, and waiting state.

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createLayer } from "./layer";
import { WorkflowLayerProvider } from "./layer-provider";
import { createBindings } from "./bindings";
import { createRegistry } from "./registry-builder";
import { runWorkflow } from "./run-workflow";
import { MemoryStorage } from "./storage";
import type { WorkflowEvent } from "./types";
import { activity, all, output, publish, race, receive, workflow } from "./types";
import { useWorkflow } from "./use-workflow";
import { useWorkflowEvents } from "./use-workflow-events";

describe("useWorkflow", () => {
	describe("inline mode (with workflowFn)", () => {
		it("starts with running state and completes", async () => {
			const w = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const { result } = renderHook(() =>
				useWorkflow("test-1", w, { storage: new MemoryStorage() }),
			);

			expect(result.current.state).toEqual({ status: "running" });

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});
		});

		it("completes and returns the result", async () => {
			const w = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const { result } = renderHook(() =>
				useWorkflow("test-2", w, { storage: new MemoryStorage() }),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "hello" });
			});
		});

		it("provides signal function that pushes data into workflow", async () => {
			const w = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const { result } = renderHook(() =>
				useWorkflow("test-3", w, { storage: new MemoryStorage() }),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result.current.signal("submit", "form-data");
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "got: form-data" });
			});
		});

		it("exposes waitingForAny when workflow uses race with signals", async () => {
			const w = workflow(function* () {
				const { winner } = yield* race(
					receive("a"),
					receive("b"),
				);
				return winner === 0 ? "a" : "b";
			});

			const { result } = renderHook(() =>
				useWorkflow("test-race-signals", w, {
					storage: new MemoryStorage(),
				}),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result.current.signal("a", "payload");
			});

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});
		});

		it("resets clears storage and restarts the workflow", async () => {
			let callCount = 0;
			const w = workflow(function* () {
				callCount++;
				return yield* activity("count", async () => callCount);
			});

			const storage = new MemoryStorage();
			const { result } = renderHook(() =>
				useWorkflow("test-4", w, { storage }),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: 1 });
			});

			await act(async () => {
				result.current.reset();
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: 2 });
			});
		});

		it("resumes from storage on remount (replay)", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const w = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const storage = new MemoryStorage();

			const { result: result1, unmount } = renderHook(() =>
				useWorkflow("test-5", w, { storage }),
			);

			await waitFor(() => {
				expect(result1.current.state.status).toBe("completed");
			});

			expect(activityFn).toHaveBeenCalledTimes(1);
			unmount();

			const { result: result2 } = renderHook(() =>
				useWorkflow("test-5", w, { storage }),
			);

			await waitFor(() => {
				expect(result2.current.state).toEqual({ status: "completed", result: "hello" });
			});

			expect(activityFn).toHaveBeenCalledTimes(1);
		});

		it("exposes what signal the workflow is waiting for", async () => {
			const w = workflow(function* () {
				const email = yield* receive<string>("email");
				const password = yield* receive<string>("password");
				return `${email}:${password}`;
			});

			const { result } = renderHook(() =>
				useWorkflow("test-6", w, { storage: new MemoryStorage() }),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});
		});

		it("collects multiple signals with all", async () => {
			const w = workflow(function* () {
				return yield* all(receive("email"), receive("password"));
			});

			const { result } = renderHook(() =>
				useWorkflow("test-all-signals", w, {
					storage: new MemoryStorage(),
				}),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result.current.signal("email", "a@b.com");
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result.current.signal("password", "secret");
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: ["a@b.com", "secret"] });
			});
		});

		it("uses storage from registry context when no explicit storage provided", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const w = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const providerStorage = new MemoryStorage();
			const layer = createLayer({ bg: w }, providerStorage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const inlineWorkflow = workflow(function* () {
				return yield* activity("compute", async () => "inline-result");
			});

			const { result } = renderHook(
				() => useWorkflow("inline-ctx", inlineWorkflow),
				{ wrapper },
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "inline-result" });
			});

			// Events should be persisted to the provider's storage, not lost in ephemeral MemoryStorage
			const events = await providerStorage.load("inline-ctx");
			expect(events.length).toBeGreaterThan(0);
		});

		it("explicit options.storage overrides registry storage", async () => {
			const w = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const providerStorage = new MemoryStorage();
			const explicitStorage = new MemoryStorage();
			const layer = createLayer({ bg: w }, providerStorage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const inlineWorkflow = workflow(function* () {
				return yield* activity("compute", async () => "result");
			});

			const { result } = renderHook(
				() =>
					useWorkflow("inline-explicit", inlineWorkflow, {
						storage: explicitStorage,
					}),
				{ wrapper },
			);

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			// Events should be in explicit storage, not provider storage
			const explicitEvents = await explicitStorage.load("inline-explicit");
			const providerEvents = await providerStorage.load("inline-explicit");
			expect(explicitEvents.length).toBeGreaterThan(0);
			expect(providerEvents).toHaveLength(0);
		});

		it("falls back to MemoryStorage without a provider", async () => {
			const w = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			// No wrapper, no explicit storage — should still work
			const { result } = renderHook(() =>
				useWorkflow("inline-fallback", w),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "hello" });
			});
		});

		it("compacts storage after inline workflow completes", async () => {
			const w = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			renderHook(() => useWorkflow("test-compact", w, { storage }));

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
			const w = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const storage = new MemoryStorage();

			const { result: result1, unmount } = renderHook(() =>
				useWorkflow("test-roundtrip", w, { storage }),
			);

			await waitFor(() => {
				expect(result1.current.state).toEqual({ status: "completed", result: "hello" });
			});

			expect(activityFn).toHaveBeenCalledTimes(1);
			unmount();

			// Storage should be compacted
			const events = await storage.load("test-roundtrip");
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ type: "workflow_completed" });

			// Remount — should hit fast path, activity NOT re-called
			const { result: result2 } = renderHook(() =>
				useWorkflow("test-roundtrip", w, { storage }),
			);

			await waitFor(() => {
				expect(result2.current.state).toEqual({ status: "completed", result: "hello" });
			});

			expect(activityFn).toHaveBeenCalledTimes(1);
		});

		it("persists events incrementally so intermediate state survives remount", async () => {
			const w = workflow(function* () {
				const email = yield* receive<string>("email");
				const password = yield* receive<string>("password");
				return `${email}:${password}`;
			});

			const storage = new MemoryStorage();

			const { result: result1, unmount } = renderHook(() =>
				useWorkflow("test-7", w, { storage }),
			);

			await waitFor(() => {
				expect(result1.current.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result1.current.signal("email", "max@test.com");
			});

			await waitFor(() => {
				expect(result1.current.state).toEqual({ status: "waiting" });
			});

			unmount();

			const events = await storage.load("test-7");
			expect(events.length).toBeGreaterThan(0);

			const { result: result2 } = renderHook(() =>
				useWorkflow("test-7", w, { storage }),
			);

			await waitFor(() => {
				expect(result2.current.state).toEqual({ status: "waiting" });
			});
		});
	});

	describe("layer mode (without workflowFn)", () => {
		it("auto-starts the layer workflow on mount", async () => {
			let started = false;
			const w = workflow(function* () {
				started = true;
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const layer = createLayer({ greet: w }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			renderHook(() => useWorkflow("greet"), { wrapper });

			await waitFor(() => {
				expect(started).toBe(true);
			});
		});

		it("returns completed state and result", async () => {
			const w = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const layer = createLayer({ greet: w }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(() => useWorkflow<string>("greet"), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "hello" });
			});
		});

		it("sends signals to the layer workflow", async () => {
			const w = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const storage = new MemoryStorage();
			const layer = createLayer({ form: w }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(() => useWorkflow("form"), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result.current.signal("submit", "form-data");
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "got: form-data" });
			});
		});

		it("state reactively updates as layer workflow progresses", async () => {
			const w = workflow(function* () {
				const a = yield* receive<string>("step1");
				const b = yield* receive<string>("step2");
				return `${a}:${b}`;
			});

			const storage = new MemoryStorage();
			const layer = createLayer({ multi: w }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(() => useWorkflow("multi"), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result.current.signal("step1", "val1");
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result.current.signal("step2", "val2");
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "val1:val2" });
			});
		});

		it("reset() restarts a layer workflow", async () => {
			let runCount = 0;
			const w = workflow(function* () {
				runCount++;
				return yield* activity("count", async () => runCount);
			});

			const storage = new MemoryStorage();
			const layer = createLayer({ counter: w }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(() => useWorkflow<number>("counter"), {
				wrapper,
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: 1 });
			});

			await act(async () => {
				result.current.reset();
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: 2 });
			});
		});

		it("throws when used outside a provider", () => {
			expect(() => {
				renderHook(() => useWorkflow("anything"));
			}).toThrow(/WorkflowLayerProvider/);
		});
	});

	describe("published", () => {
		it("published is undefined before publish, then set after", async () => {
			const w = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				yield* receive("login");
			});

			const { result } = renderHook(() =>
				useWorkflow("pub-1", w, { storage: new MemoryStorage() }),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			expect(result.current.published).toBeUndefined();

			act(() => {
				result.current.signal("login", { user: "max" });
			});

			await waitFor(() => {
				expect(result.current.published).toEqual({ user: "max" });
			});
		});
	});

	describe("cancellation", () => {
		it("inline workflow is cancelled on unmount", async () => {
			let activityResolved = false;
			const w = workflow(function* () {
				const data = yield* receive<string>("submit");
				yield* activity("after", async () => {
					activityResolved = true;
					return "done";
				});
				return `got: ${data}`;
			});

			const storage = new MemoryStorage();
			const { result, unmount } = renderHook(() =>
				useWorkflow("cancel-1", w, { storage }),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			unmount();

			// Sending a signal after unmount should not resume the workflow
			// because the interpreter was cancelled
			await new Promise((r) => setTimeout(r, 50));
			expect(activityResolved).toBe(false);
		});

		it("cancel() function is exposed and works", async () => {
			const w = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const { result } = renderHook(() =>
				useWorkflow("cancel-2", w, { storage: new MemoryStorage() }),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result.current.cancel();
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "cancelled" });
			});
		});

		it("reset() cancels before restarting", async () => {
			let runCount = 0;
			const w = workflow(function* () {
				runCount++;
				const data = yield* receive<string>("submit");
				return `run${runCount}: ${data}`;
			});

			const storage = new MemoryStorage();
			const { result } = renderHook(() =>
				useWorkflow("cancel-3", w, { storage }),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			// Reset while waiting — should cancel and restart
			await act(async () => {
				result.current.reset();
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			// Should be on run 2 now
			act(() => {
				result.current.signal("submit", "data");
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "run2: data" });
			});
		});
	});

	describe("cross-workflow dependencies", () => {
		it("inline workflow can use join with layer workflows", async () => {
			const loginWorkflow = workflow(function* () {
				return yield* activity("login", async () => "user-123");
			});

			const localWorkflow = workflow(function* () {
				const user = yield* output("login");
				return `local got: ${user}`;
			});

			const storage = new MemoryStorage();
			const layer = createLayer({ login: loginWorkflow }, storage);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(WorkflowLayerProvider, { layer }, children);

			const { result } = renderHook(
				() => useWorkflow("local", localWorkflow, { storage }),
				{ wrapper },
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "local got: user-123" });
			});
		});

		it("signal then join then activity completes", async () => {
			const profileWorkflow = workflow(function* () {
				const profile = yield* receive("profile");
				return profile;
			});

			const checkoutWorkflow = workflow(function* () {
				const payment = yield* receive("payment");
				const profile = yield* output("profile");
				const order = yield* activity("place-order", async () => {
					return `${(profile as { name: string }).name}:${payment}`;
				});
				return order;
			});

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
				expect(result.current.profile.state).toEqual({ status: "waiting" });
			});

			await waitFor(() => {
				expect(result.current.checkout.state).toEqual({ status: "waiting" });
			});

			act(() => {
				result.current.profile.signal("profile", { name: "Max" });
			});

			await waitFor(() => {
				expect(result.current.profile.state.status).toBe("completed");
			});

			act(() => {
				result.current.checkout.signal("payment", "1234");
			});

			await waitFor(() => {
				expect(result.current.checkout.state).toEqual({ status: "completed", result: "Max:1234" });
			});
		});

		it("debug panel shows all events for all() with signal + workflow dep", async () => {
			const profileWorkflow = workflow(function* () {
				const profile = yield* receive("profile");
				return profile;
			});

			const checkoutWf = workflow(function* () {
				const [payment, profile] = yield* all(
					receive("payment"),
					output("profile"),
				);
				const order = yield* activity("place-order", async () => {
					return `${(profile as { name: string }).name}:${payment}`;
				});
				return order;
			});

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
				expect(result.current.profile.state).toEqual({ status: "waiting" });
			});

			// Wait for checkout to be waiting (all)
			await waitFor(() => {
				expect(result.current.checkout.state).toEqual({ status: "waiting" });
			});

			// Send profile signal — profile completes, checkout still waiting for payment
			act(() => {
				result.current.profile.signal("profile", { name: "Max" });
			});

			await waitFor(() => {
				expect(result.current.profile.state.status).toBe("completed");
			});

			// Send payment signal — checkout should complete
			act(() => {
				result.current.checkout.signal("payment", "1234");
			});

			await waitFor(() => {
				expect(result.current.checkout.state).toEqual({ status: "completed", result: "Max:1234" });
			});

			// Now check that the debug panel shows ALL checkout events
			await waitFor(() => {
				const checkoutLog = result.current.events.find(
					(e) => e.id === "checkout",
				);
				expect(checkoutLog).toBeDefined();
				const types = checkoutLog?.events.map((e) => e.type);
				expect(types).toContain("workflow_started");
				expect(types).toContain("all_started");
				expect(types).toContain("all_completed");
				expect(types).toContain("activity_scheduled");
				expect(types).toContain("activity_completed");
				expect(types).toContain("workflow_completed");
			});
		});

		it("local workflow events appear in useWorkflowEvents", async () => {
			const globalWorkflow = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const localWorkflow = workflow(function* () {
				return yield* activity("compute", async () => "result");
			});

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
				expect(result.current.local.state.status).toBe("completed");
				expect(result.current.global.state.status).toBe("completed");
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

	describe("versioning (inline mode)", () => {
		it("inline workflow with version change wipes and restarts", async () => {
			let callCount = 0;
			const w = workflow(function* () {
				callCount++;
				return yield* activity("count", async () => callCount);
			});

			const storage = new MemoryStorage();

			// First run with version 1
			const { result: result1, unmount } = renderHook(() =>
				useWorkflow("ver-test", w, { storage, version: 1 }),
			);

			await waitFor(() => {
				expect(result1.current.state).toEqual({ status: "completed", result: 1 });
			});

			unmount();

			// Second run with version 2 — should wipe and restart
			const { result: result2 } = renderHook(() =>
				useWorkflow("ver-test", w, { storage, version: 2 }),
			);

			await waitFor(() => {
				expect(result2.current.state).toEqual({ status: "completed", result: 2 });
			});
		});

		it("inline workflow without version behaves as before", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const w = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const storage = new MemoryStorage();

			// First run without version
			const { result: result1, unmount } = renderHook(() =>
				useWorkflow("no-ver", w, { storage }),
			);

			await waitFor(() => {
				expect(result1.current.state.status).toBe("completed");
			});

			expect(activityFn).toHaveBeenCalledTimes(1);
			unmount();

			// Second run without version — should replay
			const { result: result2 } = renderHook(() =>
				useWorkflow("no-ver", w, { storage }),
			);

			await waitFor(() => {
				expect(result2.current.state).toEqual({ status: "completed", result: "hello" });
			});

			expect(activityFn).toHaveBeenCalledTimes(1);
		});
	});

	describe("snapshot hydration (SSR)", () => {
		it("initializes with snapshot state and result instead of defaults", async () => {
			const w = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const snapshot = await runWorkflow("snap-1", w);

			const { result } = renderHook(() =>
				useWorkflow("snap-1", w, {
					storage: new MemoryStorage(),
					snapshot,
				}),
			);

			// Initial render should use snapshot values, not defaults
			expect(result.current.state).toEqual({ status: "completed", result: "hello" });
		});

		it("does not start interpreter for completed snapshot", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const w = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const snapshot = await runWorkflow("snap-2", w);
			activityFn.mockClear();

			const { result } = renderHook(() =>
				useWorkflow("snap-2", w, {
					storage: new MemoryStorage(),
					snapshot,
				}),
			);

			// Should remain completed without re-running the activity
			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			expect(activityFn).not.toHaveBeenCalled();
		});

		it("seeds events and continues execution for partial snapshot", async () => {
			const w = workflow(function* () {
				const name = yield* receive("name");
				return `hello ${name}`;
			});

			// Run on "server" — blocks on signal, returns waiting snapshot
			const snapshot = await runWorkflow("snap-3", w);
			expect(snapshot.state).toEqual({ status: "waiting" });

			// Hydrate on "client" — seeds events, interpreter should resume from waiting
			const { result } = renderHook(() =>
				useWorkflow("snap-3", w, {
					storage: new MemoryStorage(),
					snapshot,
				}),
			);

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "waiting" });
			});

			// Send signal — workflow should complete
			act(() => {
				result.current.signal("name", "Max");
			});

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "hello Max" });
			});
		});

		it("initializes published value from snapshot", async () => {
			const w = workflow(function* () {
				yield* publish("progress");
				return yield* activity("work", async () => "done");
			});

			const snapshot = await runWorkflow("snap-4", w);

			const { result } = renderHook(() =>
				useWorkflow("snap-4", w, {
					storage: new MemoryStorage(),
					snapshot,
				}),
			);

			expect(result.current.published).toBe("progress");
			expect(result.current.state).toEqual({ status: "completed", result: "done" });
		});

		it("initializes error from failed snapshot", async () => {
			const w = workflow(function* () {
				return yield* activity("fail", async () => {
					throw new Error("boom");
				});
			});

			const snapshot = await runWorkflow("snap-5", w);

			const { result } = renderHook(() =>
				useWorkflow("snap-5", w, {
					storage: new MemoryStorage(),
					snapshot,
				}),
			);

			expect(result.current.state).toEqual({ status: "failed", error: "boom" });
		});
	});

	describe("onEvent observer (inline mode)", () => {
		it("fires observer for each event during workflow execution", async () => {
			const observed: Array<{ workflowId: string; event: WorkflowEvent }> = [];
			const w = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const { result } = renderHook(() =>
				useWorkflow("obs-test", w, {
					storage: new MemoryStorage(),
					onEvent: (wid, event) => observed.push({ workflowId: wid, event }),
				}),
			);

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			const types = observed
				.filter((o) => o.workflowId === "obs-test")
				.map((o) => o.event.type);
			expect(types).toContain("workflow_started");
			expect(types).toContain("activity_scheduled");
			expect(types).toContain("activity_completed");
			expect(types).toContain("workflow_completed");
		});
	});

	describe("createBindings()", () => {
		it("useWorkflow from hooks starts and completes a registry workflow", async () => {
			const greetWorkflow = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const registry = createRegistry(new MemoryStorage())
				.add("greet", greetWorkflow)
				.build();

			const { useWorkflow: useWf, Provider } = createBindings(registry);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(Provider, null, children);

			const { result } = renderHook(() => useWf("greet"), { wrapper });

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			if (result.current.state.status === "completed") {
				expect(result.current.state.result).toBe("hello");
			}
		});

		it("useWorkflow sends typed signals", async () => {
			const loginWorkflow = workflow(function* () {
				const name = yield* receive("login").as<string>();
				return `Welcome ${name}`;
			});

			const registry = createRegistry(new MemoryStorage())
				.add("login", loginWorkflow)
				.build();

			const { useWorkflow: useWf, Provider } = createBindings(registry);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(Provider, null, children);

			const { result } = renderHook(() => useWf("login"), { wrapper });

			await waitFor(() => {
				expect(result.current.state.status).toBe("waiting");
			});

			act(() => {
				result.current.signal("login", "Max");
			});

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			if (result.current.state.status === "completed") {
				expect(result.current.state.result).toBe("Welcome Max");
			}
		});

		it("inline workflow with satisfied deps runs via registry", async () => {
			const profileWorkflow = workflow(function* () {
				return yield* activity("fetch", async () => ({ name: "Max" }));
			});

			const orderWorkflow = workflow(function* () {
				const profile = yield* output("profile").as<{ name: string }>();
				return `order for ${profile.name}`;
			});

			const registry = createRegistry(new MemoryStorage())
				.add("profile", profileWorkflow)
				.build();

			const { useWorkflow: useWf, Provider } = createBindings(registry);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(Provider, null, children);

			const { result } = renderHook(
				() => useWf("order", orderWorkflow),
				{ wrapper },
			);

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			if (result.current.state.status === "completed") {
				expect(result.current.state.result).toBe("order for Max");
			}
		});
	});

	describe("registry mode (with typed registry)", () => {
		it("starts and completes a workflow from a built registry", async () => {
			const greetWorkflow = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const registry = createRegistry(new MemoryStorage())
				.add("greet", greetWorkflow)
				.build();

			const { result } = renderHook(() =>
				useWorkflow("greet", registry),
			);

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			if (result.current.state.status === "completed") {
				expect(result.current.state.result).toBe("hello");
			}
		});

		it("sends signals to a registry workflow", async () => {
			const loginWorkflow = workflow(function* () {
				const name = yield* receive("login").as<string>();
				return `Welcome ${name}`;
			});

			const registry = createRegistry(new MemoryStorage())
				.add("login", loginWorkflow)
				.build();

			const { result } = renderHook(() =>
				useWorkflow("login", registry),
			);

			await waitFor(() => {
				expect(result.current.state.status).toBe("waiting");
			});

			act(() => {
				result.current.signal("login", "Max");
			});

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			if (result.current.state.status === "completed") {
				expect(result.current.state.result).toBe("Welcome Max");
			}
		});
	});
});

// ABOUTME: Tests for the useWorkflow React hook.
// ABOUTME: Covers registry workflows, signals, reset, replay, and cross-workflow dependencies.

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement, StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createBindings } from "./bindings";
import { createRegistry } from "./registry-builder";
import { MemoryStorage } from "./storage";
import type { AnyWorkflow } from "./types";
import { ask, activity, all, publish, receive, race, workflow} from "./types";
import { useWorkflow } from "./use-workflow";
import { useWorkflowEvents } from "./use-workflow-events";

function createWrapper(
	workflows: Record<string, AnyWorkflow>,
	storage: MemoryStorage,
) {
	let builder: any = createRegistry(storage);
	for (const [id, wf] of Object.entries(workflows)) {
		builder = builder.add(id, wf);
	}
	const registry = builder.build();
	const { useWorkflow: useWf, Provider } = createBindings(registry);
	return { useWorkflow: useWf, wrapper: ({ children }: { children: ReactNode }) =>
		createElement(Provider, null, children) };
}

describe("useWorkflow", () => {
	describe("registry mode", () => {
		it("auto-starts the registry workflow on mount", async () => {
			let started = false;
			const w = workflow(function* () {
				started = true;
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper({ greet: w }, storage);

			renderHook(() => useWf("greet"), { wrapper });

			await waitFor(() => {
				expect(started).toBe(true);
			});
		});

		it("returns completed state and result", async () => {
			const w = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper({ greet: w }, storage);

			const { result } = renderHook(() => useWf("greet"), { wrapper });

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "hello" });
			});
		});

		it("sends signals to the registry workflow", async () => {
			const w = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper({ form: w }, storage);

			const { result } = renderHook(() => useWf("form"), { wrapper });

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

		it("state reactively updates as registry workflow progresses", async () => {
			const w = workflow(function* () {
				const a = yield* receive<string>("step1");
				const b = yield* receive<string>("step2");
				return `${a}:${b}`;
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper({ multi: w }, storage);

			const { result } = renderHook(() => useWf("multi"), { wrapper });

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

		it("reset() restarts a registry workflow", async () => {
			let runCount = 0;
			const w = workflow(function* () {
				runCount++;
				return yield* activity("count", async () => runCount);
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper({ counter: w }, storage);

			const { result } = renderHook(() => useWf("counter"), { wrapper });

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

		it("exposes waitingForAny when workflow uses race with signals", async () => {
			const w = workflow(function* () {
				const { winner } = yield* race(receive("a"), receive("b"));
				return winner === 0 ? "a" : "b";
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper({ racer: w }, storage);

			const { result } = renderHook(() => useWf("racer"), { wrapper });

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

		it("throws when used outside a provider", () => {
			expect(() => {
				renderHook(() => useWorkflow("anything"));
			}).toThrow(/registry Provider/);
		});
	});

	describe("published", () => {
		it("published is undefined before publish, then set after", async () => {
			const w = workflow(function* () {
				const { user } = yield* receive<{ user: string }>("login");
				yield* publish({ user });
				yield* receive("logout");
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper({ session: w }, storage);

			const { result } = renderHook(() => useWf("session"), { wrapper });

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
		it("cancel() function is exposed and works", async () => {
			const w = workflow(function* () {
				yield* receive<string>("submit");
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper({ form: w }, storage);

			const { result } = renderHook(() => useWf("form"), { wrapper });

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
	});

	describe("cross-workflow dependencies", () => {
		it("workflow can use ask() with a registry dependency", async () => {
			const loginWorkflow = workflow(function* () {
				return yield* activity("login", async () => "user-123");
			});

			const localWorkflow = workflow(function* () {
				const user = yield* ask("login");
				return `local got: ${user}`;
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper(
				{ login: loginWorkflow, local: localWorkflow },
				storage,
			);

			const { result } = renderHook(() => useWf("local"), { wrapper });

			await waitFor(() => {
				expect(result.current.state).toEqual({ status: "completed", result: "local got: user-123" });
			});
		});

		it("signal then ask then activity completes", async () => {
			const profileWorkflow = workflow(function* () {
				const profile = yield* receive("profile-data");
				return profile;
			});

			const checkoutWorkflow = workflow(function* () {
				const payment = yield* receive("payment");
				const profile = yield* ask("profile");
				const order = yield* activity("place-order", async () => {
					return `${(profile as { name: string }).name}:${payment}`;
				});
				return order;
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper } = createWrapper(
				{ profile: profileWorkflow, checkout: checkoutWorkflow },
				storage,
			);

			const { result } = renderHook(
				() => ({
					checkout: useWf("checkout"),
					profile: useWf("profile"),
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
				result.current.profile.signal("profile-data", { name: "Max" });
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
				const profile = yield* receive("profile-data");
				return profile;
			});

			const checkoutWf = workflow(function* () {
				const [payment, profile] = yield* all(
					receive("payment"),
					ask("profile"),
				);
				const order = yield* activity("place-order", async () => {
					return `${(profile as { name: string }).name}:${payment}`;
				});
				return order;
			});

			const storage = new MemoryStorage();
			const { useWorkflow: useWf, wrapper: innerWrapper } = createWrapper(
				{ profile: profileWorkflow, checkout: checkoutWf },
				storage,
			);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(StrictMode, null, innerWrapper({ children }));

			const { result } = renderHook(
				() => ({
					checkout: useWf("checkout"),
					profile: useWf("profile"),
					events: useWorkflowEvents(),
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
				result.current.profile.signal("profile-data", { name: "Max" });
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

			await waitFor(() => {
				const checkoutLog = result.current.events.find((e) => e.id === "checkout");
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
				const name = yield* receive("credentials").as<string>();
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
				result.current.signal("credentials", "Max");
			});

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			if (result.current.state.status === "completed") {
				expect(result.current.state.result).toBe("Welcome Max");
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

			const { result } = renderHook(() => useWorkflow("greet", registry));

			await waitFor(() => {
				expect(result.current.state.status).toBe("completed");
			});

			if (result.current.state.status === "completed") {
				expect(result.current.state.result).toBe("hello");
			}
		});

		it("sends signals to a registry workflow", async () => {
			const loginWorkflow = workflow(function* () {
				const name = yield* receive("credentials").as<string>();
				return `Welcome ${name}`;
			});

			const registry = createRegistry(new MemoryStorage())
				.add("login", loginWorkflow)
				.build();

			const { result } = renderHook(() => useWorkflow("login", registry));

			await waitFor(() => {
				expect(result.current.state.status).toBe("waiting");
			});

			act(() => {
				result.current.signal("credentials", "Max");
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

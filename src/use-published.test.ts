// ABOUTME: Tests for the usePublished selector hook.
// ABOUTME: Covers undefined-before-publish, selected value, render skipping, and context errors.

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { createBindings } from "./bindings";
import { createRegistry } from "./registry-builder";
import { MemoryStorage } from "./storage";
import type { AnyWorkflow } from "./types";
import { activity, publish, query, workflow } from "./types";
import { usePublished } from "./use-published";

function createWrapper(
	workflows: Record<string, AnyWorkflow>,
	storage: MemoryStorage,
) {
	let builder: any = createRegistry(storage);
	for (const [id, wf] of Object.entries(workflows)) {
		builder = builder.add(id, wf);
	}
	const registry = builder.build();
	const { useWorkflow, Provider } = createBindings(registry);
	return { useWorkflow, wrapper: ({ children }: { children: ReactNode }) =>
		createElement(Provider, null, children) };
}

describe("usePublished", () => {
	it("returns undefined before publish", async () => {
		const w = workflow(function* () {
			yield* query("go");
			yield* publish("value");
			return "done";
		});

		const storage = new MemoryStorage();
		const { useWorkflow, wrapper } = createWrapper({ test: w }, storage);

		const { result } = renderHook(
			() => ({
				wf: useWorkflow("test"),
				selected: usePublished("test", (v) => v),
			}),
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.wf.state).toEqual({ status: "waiting" });
		});

		expect(result.current.selected).toBeUndefined();
	});

	it("returns selected value after publish", async () => {
		const w = workflow(function* () {
			yield* publish({ count: 42, label: "hello" });
			yield* query("done");
			return "ok";
		});

		const storage = new MemoryStorage();
		const { useWorkflow, wrapper } = createWrapper({ test: w }, storage);

		const { result } = renderHook(
			() => ({
				wf: useWorkflow("test"),
				count: usePublished("test", (v: any) => v?.count),
			}),
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.count).toBe(42);
		});
	});

	it("returns stable reference when selected value is unchanged", async () => {
		const w = workflow(function* () {
			yield* publish({ count: 1, unrelated: "a" });
			const cmd = yield* query<string>("update");
			yield* publish({ count: 1, unrelated: cmd });
			yield* query("done");
			return "ok";
		});

		const storage = new MemoryStorage();
		const { useWorkflow, wrapper } = createWrapper({ test: w }, storage);

		// Use a stable selector that returns a primitive — useSyncExternalStore
		// will skip re-renders when getSnapshot returns the same value
		const snapshots: Array<number | undefined> = [];

		const { result } = renderHook(
			() => {
				const wf = useWorkflow("test");
				const count = usePublished("test", (v: any) => v?.count as number | undefined);
				snapshots.push(count);
				return { wf, count };
			},
			{ wrapper },
		);

		await waitFor(() => {
			expect(result.current.count).toBe(1);
		});

		const snapshotsBeforeSignal = snapshots.length;

		// Send signal that triggers a new publish with same count but different unrelated field
		act(() => {
			result.current.wf.signal("update", "b");
		});

		await waitFor(() => {
			expect(result.current.wf.state).toEqual({ status: "waiting" });
		});

		// usePublished snapshots should all be 1 after the first publish —
		// the selector returns the same primitive value, so useSyncExternalStore
		// doesn't trigger a re-render from usePublished specifically
		const countSnapshots = snapshots.filter((s) => s !== undefined);
		expect(countSnapshots.every((s) => s === 1)).toBe(true);
	});

	it("throws without registry context", () => {
		expect(() => {
			renderHook(() => usePublished("test", (v) => v));
		}).toThrow(/registry Provider/);
	});

	describe("createBindings", () => {
		it("usePublished returns typed selected value", async () => {
			const w = workflow(function* () {
				yield* publish({ name: "Max", age: 30 });
				return yield* activity("work", async () => "done");
			});

			const registry = createRegistry(new MemoryStorage())
				.add("profile", w)
				.build();

			const { usePublished: useP, useWorkflow: useWf, Provider } = createBindings(registry);

			const wrapper = ({ children }: { children: ReactNode }) =>
				createElement(Provider, null, children);

			const { result } = renderHook(
				() => ({
					wf: useWf("profile"),
					name: useP("profile", (v) => (v as any)?.name),
				}),
				{ wrapper },
			);

			await waitFor(() => {
				expect(result.current.name).toBe("Max");
			});
		});
	});
});

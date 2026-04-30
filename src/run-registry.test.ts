// ABOUTME: Tests for runRegistry — server-side registry execution for SSR.
// ABOUTME: Covers completed, waiting, failed, and multi-workflow scenarios.

import { describe, expect, it } from "vitest";
import { createRegistry } from "./registry-builder";
import { runRegistry } from "./run-registry";
import { MemoryStorage } from "./storage";
import { activity, publish, receive, workflow } from "./types";

describe("runRegistry", () => {
	it("returns a completed snapshot for a workflow that completes", async () => {
		const w = workflow(function* () {
			return yield* activity("greet", async () => "hello");
		});

		const registry = createRegistry(new MemoryStorage()).add("greet", w).build();
		const snapshots = await runRegistry(registry);

		expect(snapshots.greet.state).toEqual({ status: "completed", result: "hello" });
		expect(snapshots.greet.workflowId).toBe("greet");
		expect(snapshots.greet.events.length).toBeGreaterThan(0);
	});

	it("returns a waiting snapshot for a workflow blocked on receive", async () => {
		const w = workflow(function* () {
			yield* receive<string>("submit");
		});

		const registry = createRegistry(new MemoryStorage()).add("form", w).build();
		const snapshots = await runRegistry(registry);

		expect(snapshots.form.state).toEqual({ status: "waiting" });
		expect(snapshots.form.events.some((e) => e.type === "workflow_started")).toBe(true);
	});

	it("returns a failed snapshot for a workflow that throws", async () => {
		const w = workflow(function* () {
			return yield* activity("boom", async () => {
				throw new Error("something went wrong");
			});
		});

		const registry = createRegistry(new MemoryStorage()).add("failing", w).build();
		const snapshots = await runRegistry(registry);

		expect(snapshots.failing.state).toEqual({ status: "failed", error: "something went wrong" });
	});

	it("captures the published value in the snapshot", async () => {
		const w = workflow(function* () {
			yield* publish({ user: "max" });
			yield* receive<string>("done");
		});

		const registry = createRegistry(new MemoryStorage()).add("session", w).build();
		const snapshots = await runRegistry(registry);

		expect(snapshots.session.state).toEqual({ status: "waiting" });
		expect(snapshots.session.published).toEqual({ user: "max" });
	});

	it("runs all workflows when no ids specified", async () => {
		const a = workflow(function* () { return yield* activity("a", async () => 1); });
		const b = workflow(function* () { return yield* activity("b", async () => 2); });

		const registry = createRegistry(new MemoryStorage())
			.add("a", a)
			.add("b", b)
			.build();

		const snapshots = await runRegistry(registry);

		expect(snapshots.a.state).toEqual({ status: "completed", result: 1 });
		expect(snapshots.b.state).toEqual({ status: "completed", result: 2 });
	});

	it("runs only the specified ids when provided", async () => {
		const a = workflow(function* () { return yield* activity("a", async () => 1); });
		const b = workflow(function* () { return yield* activity("b", async () => 2); });

		const registry = createRegistry(new MemoryStorage())
			.add("a", a)
			.add("b", b)
			.build();

		const snapshots = await runRegistry(registry, ["a"]);

		expect(snapshots.a.state).toEqual({ status: "completed", result: 1 });
		expect("b" in snapshots).toBe(false);
	});

	it("events in snapshot are serializable", async () => {
		const w = workflow(function* () {
			return yield* activity("work", async () => ({ value: 42 }));
		});

		const registry = createRegistry(new MemoryStorage()).add("work", w).build();
		const snapshots = await runRegistry(registry);

		// Should not throw
		expect(() => JSON.stringify(snapshots.work)).not.toThrow();
	});
});

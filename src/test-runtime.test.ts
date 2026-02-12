// ABOUTME: Tests for the synchronous test runtime.
// ABOUTME: Covers running workflows with mock activities and pre-queued signals.

import { describe, expect, it } from "vitest";
import { createTestRuntime } from "./test-runtime";
import type { WorkflowFunction } from "./types";

describe("createTestRuntime", () => {
	it("runs a workflow with mock activities", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const greeting = yield* ctx.activity("greet", async () => "real");
			return greeting;
		};

		const result = await createTestRuntime(workflow, {
			activities: {
				greet: () => "mocked hello",
			},
		});

		expect(result).toBe("mocked hello");
	});

	it("runs a workflow with pre-queued signals", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const data = yield* ctx.waitFor<string>("submit");
			return `got: ${data}`;
		};

		const result = await createTestRuntime(workflow, {
			signals: [{ name: "submit", payload: "test-data" }],
		});

		expect(result).toBe("got: test-data");
	});

	it("handles multiple activities and signals together", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const user = yield* ctx.activity("fetchUser", async () => "real-user");
			const input = yield* ctx.waitFor<string>("confirm");
			const saved = yield* ctx.activity("save", async () => "real-save");
			return `${user}:${input}:${saved}`;
		};

		const result = await createTestRuntime(workflow, {
			activities: {
				fetchUser: () => "mock-user",
				save: () => "mock-save",
			},
			signals: [{ name: "confirm", payload: "yes" }],
		});

		expect(result).toBe("mock-user:yes:mock-save");
	});

	it("falls through to real activity when no mock is provided", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const result = yield* ctx.activity("real", async () => "actual-result");
			return result;
		};

		const result = await createTestRuntime(workflow, {});

		expect(result).toBe("actual-result");
	});

	it("throws if workflow fails", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			return yield* ctx.activity("fail", async () => {
				throw new Error("boom");
			});
		};

		await expect(createTestRuntime(workflow, {})).rejects.toThrow("boom");
	});

	it("runs a workflow with waitAll and pre-queued signals", async () => {
		const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
			return yield* ctx.waitAll("email", "password");
		};

		const result = await createTestRuntime(workflow, {
			signals: [
				{ name: "email", payload: "test@example.com" },
				{ name: "password", payload: "secret123" },
			],
		});

		expect(result).toEqual(["test@example.com", "secret123"]);
	});

	it("supports multiple sequential signals", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			const email = yield* ctx.waitFor<string>("email");
			const password = yield* ctx.waitFor<string>("password");
			return `${email}:${password}`;
		};

		const result = await createTestRuntime(workflow, {
			signals: [
				{ name: "email", payload: "test@example.com" },
				{ name: "password", payload: "secret123" },
			],
		});

		expect(result).toBe("test@example.com:secret123");
	});
});

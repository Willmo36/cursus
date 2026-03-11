// ABOUTME: Tests for the synchronous test runtime.
// ABOUTME: Covers running workflows with mock activities and pre-queued signals.

import { describe, expect, it } from "vitest";
import { createTestRuntime } from "./test-runtime";
import { workflow } from "./types";
import type { WorkflowContext } from "./types";

describe("createTestRuntime", () => {
	it("runs a workflow with mock activities", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			const greeting = yield* ctx.activity("greet", async () => "real");
			return greeting;
		});

		const result = await createTestRuntime(wf, {
			activities: {
				greet: () => "mocked hello",
			},
		});

		expect(result).toBe("mocked hello");
	});

	it("runs a workflow with pre-queued signals", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			const data = yield* ctx.receive<string>("submit");
			return `got: ${data}`;
		});

		const result = await createTestRuntime(wf, {
			signals: [{ name: "submit", payload: "test-data" }],
		});

		expect(result).toBe("got: test-data");
	});

	it("handles multiple activities and signals together", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			const user = yield* ctx.activity("fetchUser", async () => "real-user");
			const input = yield* ctx.receive<string>("confirm");
			const saved = yield* ctx.activity("save", async () => "real-save");
			return `${user}:${input}:${saved}`;
		});

		const result = await createTestRuntime(wf, {
			activities: {
				fetchUser: () => "mock-user",
				save: () => "mock-save",
			},
			signals: [{ name: "confirm", payload: "yes" }],
		});

		expect(result).toBe("mock-user:yes:mock-save");
	});

	it("falls through to real activity when no mock is provided", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			const result = yield* ctx.activity("real", async () => "actual-result");
			return result;
		});

		const result = await createTestRuntime(wf, {});

		expect(result).toBe("actual-result");
	});

	it("throws if workflow fails", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			return yield* ctx.activity("fail", async () => {
				throw new Error("boom");
			});
		});

		await expect(createTestRuntime(wf, {})).rejects.toThrow("boom");
	});

	it("runs a workflow with all and pre-queued signals", async () => {
		const wf = workflow(function* (ctx: WorkflowContext<{ email: string; password: string }>) {
			return yield* ctx.all(ctx.receive("email"), ctx.receive("password"));
		});

		const result = await createTestRuntime(wf, {
			signals: [
				{ name: "email", payload: "test@example.com" },
				{ name: "password", payload: "secret123" },
			],
		});

		expect(result).toEqual(["test@example.com", "secret123"]);
	});

	it("supports multiple sequential signals", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			const email = yield* ctx.receive<string>("email");
			const password = yield* ctx.receive<string>("password");
			return `${email}:${password}`;
		});

		const result = await createTestRuntime(wf, {
			signals: [
				{ name: "email", payload: "test@example.com" },
				{ name: "password", payload: "secret123" },
			],
		});

		expect(result).toBe("test@example.com:secret123");
	});

	it("mocks join with workflowResults", async () => {
		const wf = workflow(function* (ctx: WorkflowContext<Record<string, unknown>, { login: string }>) {
			const user = yield* ctx.join("login");
			return `got: ${user}`;
		});

		const result = await createTestRuntime(wf, {
			workflowResults: {
				login: "test-user",
			},
		});

		expect(result).toBe("got: test-user");
	});

	it("workflowResults works alongside activities and signals", async () => {
		const wf = workflow(function* (ctx: WorkflowContext<Record<string, unknown>, { login: string }>) {
			const user = yield* ctx.join("login");
			const greeting = yield* ctx.activity("greet", async () => "real");
			const confirm = yield* ctx.receive("confirm");
			return `${user}:${greeting}:${confirm}`;
		});

		const result = await createTestRuntime(wf, {
			workflowResults: { login: "mock-user" },
			activities: { greet: () => "mock-hello" },
			signals: [{ name: "confirm", payload: "yes" }],
		});

		expect(result).toBe("mock-user:mock-hello:yes");
	});

	it("handles workflow that catches activity error", async () => {
		const wf = workflow(function* (ctx: WorkflowContext) {
			try {
				yield* ctx.activity("fail", async () => {
					throw new Error("boom");
				});
				return "unreachable";
			} catch {
				const result = yield* ctx.activity("recover", async () => "recovered");
				return result;
			}
		});

		const result = await createTestRuntime(wf, {
			activities: {
				recover: () => "mock-recovered",
			},
		});

		expect(result).toBe("mock-recovered");
	});

	it("runs mixed all with signals and workflowResults", async () => {
		const wf = workflow(function* (ctx: WorkflowContext<Record<string, unknown>, { profile: unknown }>) {
			return yield* ctx.all(ctx.receive("payment"), ctx.workflow("profile"));
		});

		const result = await createTestRuntime(wf, {
			signals: [{ name: "payment", payload: { card: "1234" } }],
			workflowResults: { profile: { name: "Max" } },
		});

		expect(result).toEqual([{ card: "1234" }, { name: "Max" }]);
	});

	it("runs a workflow with race and pre-queued signals", async () => {
		const wf = workflow(function* (ctx: WorkflowContext<{ a: string; b: string }>) {
			const { winner, value } = yield* ctx.race(
				ctx.receive("a"),
				ctx.receive("b"),
			);
			return winner === 0 ? `a:${value}` : `b:${value}`;
		});

		const result = await createTestRuntime(wf, {
			signals: [{ name: "b", payload: "bee" }],
		});

		expect(result).toBe("b:bee");
	});

	it("runs an on/done loop with pre-queued signals", async () => {
		const wf = workflow(function* (ctx: WorkflowContext<{ inc: undefined; finish: undefined }>) {
			let count = 0;
			return yield* ctx.handle<number>({
				inc: function* () {
					count++;
				},
				finish: function* (_ctx, _payload, done) {
					yield* done(count);
				},
			});
		});

		const result = await createTestRuntime(wf, {
			signals: [
				{ name: "inc", payload: undefined },
				{ name: "inc", payload: undefined },
				{ name: "finish", payload: undefined },
			],
		});

		expect(result).toBe(2);
	});

	describe("mock propagation into child workflows", () => {
		it("activity mocks apply inside child workflows", async () => {
			const childWorkflow = workflow(function* (ctx: WorkflowContext) {
				return yield* ctx.activity("greet", async () => "real");
			});

			const parentWorkflow = workflow(function* (ctx: WorkflowContext) {
				return yield* ctx.child("sub", childWorkflow);
			});

			const result = await createTestRuntime(parentWorkflow, {
				activities: { greet: () => "mocked" },
			});

			expect(result).toBe("mocked");
		});

		it("activity mocks apply inside nested grandchild workflows", async () => {
			const grandchild = workflow(function* (ctx: WorkflowContext) {
				return yield* ctx.activity("fetch", async () => "real-data");
			});

			const child = workflow(function* (ctx: WorkflowContext) {
				return yield* ctx.child("grandchild", grandchild);
			});

			const parent = workflow(function* (ctx: WorkflowContext) {
				return yield* ctx.child("child", child);
			});

			const result = await createTestRuntime(parent, {
				activities: { fetch: () => "mock-data" },
			});

			expect(result).toBe("mock-data");
		});

		it("unmocked activities fall through to real implementation in children", async () => {
			const childWorkflow = workflow(function* (ctx: WorkflowContext) {
				const a = yield* ctx.activity("mocked", async () => "real-a");
				const b = yield* ctx.activity("unmocked", async () => "real-b");
				return `${a}:${b}`;
			});

			const parentWorkflow = workflow(function* (ctx: WorkflowContext) {
				return yield* ctx.child("sub", childWorkflow);
			});

			const result = await createTestRuntime(parentWorkflow, {
				activities: { mocked: () => "mock-a" },
			});

			expect(result).toBe("mock-a:real-b");
		});

		it("pre-queued signals work with child workflows", async () => {
			const childWorkflow = workflow(function* (ctx: WorkflowContext<{ data: string }>) {
				const val = yield* ctx.receive("data");
				const greeting = yield* ctx.activity("greet", async () => "real");
				return `${greeting}: ${val}`;
			});

			const parentWorkflow = workflow(function* (ctx: WorkflowContext<{ data: string }>) {
				return yield* ctx.child("sub", childWorkflow);
			});

			const result = await createTestRuntime(parentWorkflow, {
				activities: { greet: () => "mocked" },
				signals: [{ name: "data", payload: "hello" }],
			});

			expect(result).toBe("mocked: hello");
		});
	});
});

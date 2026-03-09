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

	it("runs a workflow with waitForAll and pre-queued signals", async () => {
		const workflow: WorkflowFunction<
			[string, string],
			{ email: string; password: string }
		> = function* (ctx) {
			return yield* ctx.waitForAll("email", "password");
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

	it("mocks join with workflowResults", async () => {
		const wf: WorkflowFunction<
			string,
			Record<string, unknown>,
			{ login: string }
		> = function* (ctx) {
			const user = yield* ctx.join("login");
			return `got: ${user}`;
		};

		const result = await createTestRuntime(wf, {
			workflowResults: {
				login: "test-user",
			},
		});

		expect(result).toBe("got: test-user");
	});

	it("workflowResults works alongside activities and signals", async () => {
		const wf: WorkflowFunction<
			string,
			Record<string, unknown>,
			{ login: string }
		> = function* (ctx) {
			const user = yield* ctx.join("login");
			const greeting = yield* ctx.activity("greet", async () => "real");
			const confirm = yield* ctx.waitFor("confirm");
			return `${user}:${greeting}:${confirm}`;
		};

		const result = await createTestRuntime(wf, {
			workflowResults: { login: "mock-user" },
			activities: { greet: () => "mock-hello" },
			signals: [{ name: "confirm", payload: "yes" }],
		});

		expect(result).toBe("mock-user:mock-hello:yes");
	});

	it("handles workflow that catches activity error", async () => {
		const workflow: WorkflowFunction<string> = function* (ctx) {
			try {
				yield* ctx.activity("fail", async () => {
					throw new Error("boom");
				});
				return "unreachable";
			} catch {
				const result = yield* ctx.activity("recover", async () => "recovered");
				return result;
			}
		};

		const result = await createTestRuntime(workflow, {
			activities: {
				recover: () => "mock-recovered",
			},
		});

		expect(result).toBe("mock-recovered");
	});

	it("runs mixed waitForAll with signals and workflowResults", async () => {
		const wf: WorkflowFunction<
			unknown,
			Record<string, unknown>,
			{ profile: unknown }
		> = function* (ctx) {
			return yield* ctx.waitForAll("payment", ctx.workflow("profile"));
		};

		const result = await createTestRuntime(wf, {
			signals: [{ name: "payment", payload: { card: "1234" } }],
			workflowResults: { profile: { name: "Max" } },
		});

		expect(result).toEqual([{ card: "1234" }, { name: "Max" }]);
	});

	it("runs a workflow with waitForAny and pre-queued signals", async () => {
		const workflow: WorkflowFunction<string, { a: string; b: string }> =
			function* (ctx) {
				const { signal, payload } = yield* ctx.waitForAny("a", "b");
				return `${signal}:${payload}`;
			};

		const result = await createTestRuntime(workflow, {
			signals: [{ name: "b", payload: "bee" }],
		});

		expect(result).toBe("b:bee");
	});

	it("runs an on/done loop with pre-queued signals", async () => {
		const workflow: WorkflowFunction<
			number,
			{ inc: undefined; finish: undefined }
		> = function* (ctx) {
			let count = 0;
			return yield* ctx.on<number>({
				inc: function* () {
					count++;
				},
				finish: function* (ctx) {
					yield* ctx.done(count);
				},
			});
		};

		const result = await createTestRuntime(workflow, {
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
			const childWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "real");
			};

			const parentWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.child("sub", childWorkflow);
			};

			const result = await createTestRuntime(parentWorkflow, {
				activities: { greet: () => "mocked" },
			});

			expect(result).toBe("mocked");
		});

		it("activity mocks apply inside nested grandchild workflows", async () => {
			const grandchild: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("fetch", async () => "real-data");
			};

			const child: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.child("grandchild", grandchild);
			};

			const parent: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.child("child", child);
			};

			const result = await createTestRuntime(parent, {
				activities: { fetch: () => "mock-data" },
			});

			expect(result).toBe("mock-data");
		});

		it("unmocked activities fall through to real implementation in children", async () => {
			const childWorkflow: WorkflowFunction<string> = function* (ctx) {
				const a = yield* ctx.activity("mocked", async () => "real-a");
				const b = yield* ctx.activity("unmocked", async () => "real-b");
				return `${a}:${b}`;
			};

			const parentWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.child("sub", childWorkflow);
			};

			const result = await createTestRuntime(parentWorkflow, {
				activities: { mocked: () => "mock-a" },
			});

			expect(result).toBe("mock-a:real-b");
		});

		it("pre-queued signals work with child workflows", async () => {
			const childWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					const val = yield* ctx.waitFor("data");
					const greeting = yield* ctx.activity("greet", async () => "real");
					return `${greeting}: ${val}`;
				};

			const parentWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					return yield* ctx.child("sub", childWorkflow);
				};

			const result = await createTestRuntime(parentWorkflow, {
				activities: { greet: () => "mocked" },
				signals: [{ name: "data", payload: "hello" }],
			});

			expect(result).toBe("mocked: hello");
		});
	});
});

// ABOUTME: Tests for the workflow interpreter runtime.
// ABOUTME: Covers activity execution, replay, signals, sleep, parallel, and child workflows.

import { describe, expect, it, vi } from "vitest";
import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import type { WorkflowFunction, WorkflowRegistryInterface } from "./types";

describe("Interpreter", () => {
	describe("Phase A: basic activity execution", () => {
		it("runs a workflow that yields one activity and gets the result", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const result = yield* ctx.activity("greet", async () => "hello");
				return result;
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("hello");
			expect(interpreter.state).toBe("completed");
		});

		it("runs a workflow that yields two sequential activities", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const a = yield* ctx.activity("first", async () => "one");
				const b = yield* ctx.activity("second", async () => "two");
				return `${a}-${b}`;
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("one-two");
		});

		it("records activity events in the log", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			const events = log.events();
			expect(events[0]).toMatchObject({ type: "workflow_started" });
			expect(events[1]).toMatchObject({
				type: "activity_scheduled",
				name: "greet",
				seq: 1,
			});
			expect(events[2]).toMatchObject({
				type: "activity_completed",
				seq: 1,
				result: "hello",
			});
			expect(events[3]).toMatchObject({
				type: "workflow_completed",
				result: "hello",
			});
		});

		it("propagates activity failure to workflow", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("fail", async () => {
					throw new Error("boom");
				});
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("boom");

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "activity_failed",
					seq: 1,
					error: "boom",
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({ type: "workflow_failed", error: "boom" }),
			);
		});
	});

	describe("Phase B: replay", () => {
		it("replays a workflow from a pre-populated event log without executing activities", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", activityFn);
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{ type: "activity_scheduled", name: "greet", seq: 1, timestamp: 2 },
				{ type: "activity_completed", seq: 1, result: "hello", timestamp: 3 },
				{ type: "workflow_completed", result: "hello", timestamp: 4 },
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("hello");
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("transitions from replay to live execution when log is exhausted", async () => {
			const liveFn = vi.fn().mockResolvedValue("live-result");
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const a = yield* ctx.activity("first", async () => "replayed");
				const b = yield* ctx.activity("second", liveFn);
				return `${a}-${b}`;
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{ type: "activity_scheduled", name: "first", seq: 1, timestamp: 2 },
				{
					type: "activity_completed",
					seq: 1,
					result: "replayed",
					timestamp: 3,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("replayed-live-result");
			expect(liveFn).toHaveBeenCalledOnce();
		});

		it("detects non-determinism when command does not match event", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("different-name", async () => "x");
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "activity_scheduled",
					name: "original-name",
					seq: 1,
					timestamp: 2,
				},
				{ type: "activity_completed", seq: 1, result: "x", timestamp: 3 },
			]);

			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toContain("Non-determinism detected");
		});
	});

	describe("Phase C: signals (waitFor)", () => {
		it("pauses on waitFor and resumes when signal is received", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			// Should be waiting after run starts
			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingFor).toBe("submit");
			});

			interpreter.signal("submit", "form-data");

			const result = await runPromise;
			expect(result).toBe("got: form-data");
			expect(interpreter.state).toBe("completed");
		});

		it("replays signal from event log", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "signal_received",
					signal: "submit",
					payload: "saved-data",
					seq: 1,
					timestamp: 2,
				},
				{ type: "workflow_completed", result: "got: saved-data", timestamp: 3 },
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("got: saved-data");
		});

		it("handles multiple sequential waitFor calls", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const email = yield* ctx.waitFor<string>("email");
				const password = yield* ctx.waitFor<string>("password");
				return `${email}:${password}`;
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.waitingFor).toBe("email");
			});

			interpreter.signal("email", "test@example.com");

			await vi.waitFor(() => {
				expect(interpreter.waitingFor).toBe("password");
			});

			interpreter.signal("password", "secret");

			const result = await runPromise;
			expect(result).toBe("test@example.com:secret");
		});
	});

	describe("Phase D: sleep", () => {
		it("pauses for the specified duration then resumes", async () => {
			vi.useFakeTimers();

			const workflow: WorkflowFunction<string> = function* (ctx) {
				yield* ctx.sleep(1000);
				return "done";
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			const runPromise = interpreter.run();

			// Timer should be started but not fired
			await vi.advanceTimersByTimeAsync(500);
			expect(interpreter.state).toBe("running");

			await vi.advanceTimersByTimeAsync(500);
			const result = await runPromise;

			expect(result).toBe("done");
			expect(interpreter.state).toBe("completed");

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "timer_started",
					seq: 1,
					durationMs: 1000,
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({ type: "timer_fired", seq: 1 }),
			);

			vi.useRealTimers();
		});

		it("fires immediately during replay if duration has elapsed", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				yield* ctx.sleep(1000);
				return "done";
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{ type: "timer_started", seq: 1, durationMs: 1000, timestamp: 2 },
				{ type: "timer_fired", seq: 1, timestamp: 1003 },
				{ type: "workflow_completed", result: "done", timestamp: 1004 },
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("done");
		});
	});

	describe("Phase E: parallel", () => {
		it("runs multiple activities concurrently and returns all results", async () => {
			const workflow: WorkflowFunction<string[]> = function* (ctx) {
				return yield* ctx.parallel([
					{ name: "a", fn: async () => "one" },
					{ name: "b", fn: async () => "two" },
				]);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
		});

		it("replays parallel activities from event log", async () => {
			const fnA = vi.fn().mockResolvedValue("one");
			const fnB = vi.fn().mockResolvedValue("two");

			const workflow: WorkflowFunction<string[]> = function* (ctx) {
				return yield* ctx.parallel([
					{ name: "a", fn: fnA },
					{ name: "b", fn: fnB },
				]);
			};

			// seq 1 = parallel command, seq 2 = activity "a", seq 3 = activity "b"
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{ type: "activity_scheduled", name: "a", seq: 2, timestamp: 2 },
				{ type: "activity_completed", seq: 2, result: "one", timestamp: 3 },
				{ type: "activity_scheduled", name: "b", seq: 3, timestamp: 2 },
				{ type: "activity_completed", seq: 3, result: "two", timestamp: 3 },
				{ type: "workflow_completed", result: ["one", "two"], timestamp: 4 },
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
			expect(fnA).not.toHaveBeenCalled();
			expect(fnB).not.toHaveBeenCalled();
		});

		it("fails the whole parallel command if one activity fails", async () => {
			const workflow: WorkflowFunction<string[]> = function* (ctx) {
				return yield* ctx.parallel([
					{ name: "ok", fn: async () => "fine" },
					{
						name: "bad",
						fn: async () => {
							throw new Error("oops");
						},
					},
				]);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("oops");
		});
	});

	describe("Phase F: waitAll", () => {
		it("collects multiple signals in any order and returns tuple in declaration order", async () => {
			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.waitAll("email", "password");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			// Send in reverse order
			interpreter.signal("password", "secret");

			// Should still be waiting for email
			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("email", "a@b.com");

			const result = await runPromise;
			// Tuple in declaration order regardless of signal arrival order
			expect(result).toEqual(["a@b.com", "secret"]);
			expect(interpreter.state).toBe("completed");
		});

		it("records wait_all_started and wait_all_completed events", async () => {
			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.waitAll("a", "b");
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("a", "val-a");

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("b", "val-b");
			await runPromise;

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "wait_all_started",
					signals: ["a", "b"],
					seq: 1,
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "wait_all_completed",
					seq: 1,
					results: { a: "val-a", b: "val-b" },
				}),
			);
		});

		it("replays waitAll from event log", async () => {
			const workflow: WorkflowFunction<[string, number]> = function* (ctx) {
				return yield* ctx.waitAll("name", "age");
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "wait_all_started",
					signals: ["name", "age"],
					seq: 1,
					timestamp: 2,
				},
				{
					type: "wait_all_completed",
					seq: 1,
					results: { name: "Max", age: 30 },
					timestamp: 3,
				},
				{
					type: "workflow_completed",
					result: ["Max", 30],
					timestamp: 4,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toEqual(["Max", 30]);
		});

		it("exposes waitingForAll with remaining signal names", async () => {
			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.waitAll("email", "password");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingForAll).toEqual(["email", "password"]);
			});

			interpreter.signal("email", "a@b.com");

			await vi.waitFor(() => {
				expect(interpreter.waitingForAll).toEqual(["password"]);
			});
		});
	});

	describe("Phase G: child workflows", () => {
		it("runs a child workflow and returns its result to the parent", async () => {
			const childWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("childTask", async () => "child-result");
			};

			const parentWorkflow: WorkflowFunction<string> = function* (ctx) {
				const childResult = yield* ctx.child("sub", childWorkflow);
				return `parent got: ${childResult}`;
			};

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("parent got: child-result");
			expect(interpreter.state).toBe("completed");
		});

		it("child workflow has its own event log", async () => {
			const childWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("childTask", async () => "child-result");
			};

			const parentWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.child("sub", childWorkflow);
			};

			const parentLog = new EventLog();
			const interpreter = new Interpreter(parentWorkflow, parentLog);
			await interpreter.run();

			const parentEvents = parentLog.events();
			expect(parentEvents).toContainEqual(
				expect.objectContaining({ type: "child_started", name: "sub" }),
			);
			expect(parentEvents).toContainEqual(
				expect.objectContaining({
					type: "child_completed",
					result: "child-result",
				}),
			);
			// Child's activity events should NOT be in the parent log
			expect(parentEvents).not.toContainEqual(
				expect.objectContaining({
					type: "activity_scheduled",
					name: "childTask",
				}),
			);
		});

		it("replays child workflow from parent event log", async () => {
			const childFn = vi.fn();

			const childWorkflow: WorkflowFunction<string> = function* (ctx) {
				childFn();
				return yield* ctx.activity("childTask", async () => "child-result");
			};

			const parentWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.child("sub", childWorkflow);
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "child_started",
					name: "sub",
					workflowId: "sub",
					seq: 1,
					timestamp: 2,
				},
				{
					type: "child_completed",
					workflowId: "sub",
					seq: 1,
					result: "child-result",
					timestamp: 3,
				},
				{ type: "workflow_completed", result: "child-result", timestamp: 4 },
			]);

			const interpreter = new Interpreter(parentWorkflow, log);
			const result = await interpreter.run();

			expect(result).toBe("child-result");
			// Child workflow generator should not even be called during replay
			expect(childFn).not.toHaveBeenCalled();
		});
	});

	describe("Phase H: waitForWorkflow", () => {
		it("delegates to registry and returns the result", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("login-result"),
				start: vi.fn(),
			};

			const workflow: WorkflowFunction<string> = function* (ctx) {
				const user = yield* ctx.waitForWorkflow<string>("login");
				return `got: ${user}`;
			};

			const interpreter = new Interpreter(
				workflow,
				new EventLog(),
				mockRegistry,
			);
			const result = await interpreter.run();

			expect(result).toBe("got: login-result");
			expect(mockRegistry.waitFor).toHaveBeenCalledWith("login", {
				start: true,
			});
		});

		it("passes start: false option to registry", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("result"),
				start: vi.fn(),
			};

			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.waitForWorkflow<string>("login", { start: false });
			};

			const interpreter = new Interpreter(
				workflow,
				new EventLog(),
				mockRegistry,
			);
			await interpreter.run();

			expect(mockRegistry.waitFor).toHaveBeenCalledWith("login", {
				start: false,
			});
		});

		it("throws without a registry", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.waitForWorkflow<string>("login");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toContain("WorkflowRegistry");
		});

		it("records dependency_started and dependency_completed events", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("user-data"),
				start: vi.fn(),
			};

			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.waitForWorkflow<string>("login");
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log, mockRegistry);
			await interpreter.run();

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_started",
					workflowId: "login",
					seq: 1,
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_completed",
					workflowId: "login",
					seq: 1,
					result: "user-data",
				}),
			);
		});

		it("replays from event log without calling registry", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn(),
				start: vi.fn(),
			};

			const workflow: WorkflowFunction<string> = function* (ctx) {
				const user = yield* ctx.waitForWorkflow<string>("login");
				return `got: ${user}`;
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "workflow_dependency_started",
					workflowId: "login",
					seq: 1,
					timestamp: 2,
				},
				{
					type: "workflow_dependency_completed",
					workflowId: "login",
					seq: 1,
					result: "cached-user",
					timestamp: 3,
				},
				{
					type: "workflow_completed",
					result: "got: cached-user",
					timestamp: 4,
				},
			]);

			const interpreter = new Interpreter(workflow, log, mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("got: cached-user");
			expect(mockRegistry.waitFor).not.toHaveBeenCalled();
		});
	});
});

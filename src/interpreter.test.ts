// ABOUTME: Tests for the workflow interpreter runtime.
// ABOUTME: Covers activity execution, replay, signals, sleep, parallel, and child workflows.

import { describe, expect, it, vi } from "vitest";
import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import {
	CancelledError,
	type WorkflowFunction,
	type WorkflowRegistryInterface,
} from "./types";

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

		it("preserves stack trace on activity_failed and workflow_failed events", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("fail", async () => {
					throw new Error("boom");
				});
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			const events = log.events();
			const activityFailed = events.find((e) => e.type === "activity_failed");
			expect(activityFailed).toBeDefined();
			expect(
				activityFailed?.type === "activity_failed" && activityFailed.stack,
			).toMatch(/Error: boom/);
			expect(
				activityFailed?.type === "activity_failed" && activityFailed.stack,
			).toContain("\n");

			const workflowFailed = events.find((e) => e.type === "workflow_failed");
			expect(workflowFailed).toBeDefined();
			expect(
				workflowFailed?.type === "workflow_failed" && workflowFailed.stack,
			).toMatch(/Error: boom/);
		});

		it("handles non-Error throws without stack", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("fail", async () => {
					throw "string error";
				});
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			const events = log.events();
			const activityFailed = events.find((e) => e.type === "activity_failed");
			expect(activityFailed).toBeDefined();
			expect(
				activityFailed?.type === "activity_failed" && activityFailed.stack,
			).toBeUndefined();
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
			const workflow: WorkflowFunction<
				[string, string],
				{ email: string; password: string }
			> = function* (ctx) {
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
			const workflow: WorkflowFunction<
				[string, string],
				{ a: string; b: string }
			> = function* (ctx) {
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
					items: [
						{ kind: "signal", name: "a" },
						{ kind: "signal", name: "b" },
					],
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
			const workflow: WorkflowFunction<
				[string, number],
				{ name: string; age: number }
			> = function* (ctx) {
				return yield* ctx.waitAll("name", "age");
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "wait_all_started",
					items: [
						{ kind: "signal", name: "name" },
						{ kind: "signal", name: "age" },
					],
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
			const workflow: WorkflowFunction<
				[string, string],
				{ email: string; password: string }
			> = function* (ctx) {
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

		it("collects signal and workflow result concurrently in mixed waitAll", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue({ name: "Max" }),
				start: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.waitAll("payment", ctx.workflow("profile"));
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingForAll).toEqual(["payment"]);
			});

			interpreter.signal("payment", { card: "1234" });

			const result = await runPromise;
			expect(result).toEqual([{ card: "1234" }, { name: "Max" }]);
			expect(interpreter.state).toBe("completed");
			expect(mockRegistry.waitFor).toHaveBeenCalledWith("profile", {
				start: true,
			});
		});

		it("records events for mixed waitAll", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("profile-data"),
				start: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.waitAll("payment", ctx.workflow("profile"));
			};

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("payment", "pay-data");
			await runPromise;

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "wait_all_started",
					items: [
						{ kind: "signal", name: "payment" },
						{ kind: "workflow", workflowId: "profile" },
					],
					seq: 1,
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_started",
					workflowId: "profile",
					seq: 1,
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_completed",
					workflowId: "profile",
					result: "profile-data",
					seq: 1,
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "wait_all_completed",
					seq: 1,
					results: { payment: "pay-data", "workflow:profile": "profile-data" },
				}),
			);
		});

		it("throws without registry when mixed waitAll has workflow items", async () => {
			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.waitAll("payment", ctx.workflow("profile"));
			};

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toContain("WorkflowRegistry");
		});

		it("replays mixed waitAll from event log", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn(),
				start: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.waitAll("payment", ctx.workflow("profile"));
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "wait_all_started",
					items: [
						{ kind: "signal", name: "payment" },
						{ kind: "workflow", workflowId: "profile" },
					],
					seq: 1,
					timestamp: 2,
				},
				{
					type: "wait_all_completed",
					seq: 1,
					results: {
						payment: { card: "1234" },
						"workflow:profile": { name: "Max" },
					},
					timestamp: 3,
				},
				{
					type: "workflow_completed",
					result: [{ card: "1234" }, { name: "Max" }],
					timestamp: 4,
				},
			]);

			const interpreter = new Interpreter(wf, log, mockRegistry);
			const result = await interpreter.run();

			expect(result).toEqual([{ card: "1234" }, { name: "Max" }]);
			expect(mockRegistry.waitFor).not.toHaveBeenCalled();
		});

		it("handles signal arriving after workflow completes in mixed waitAll", async () => {
			let resolveWorkflow: ((value: unknown) => void) | undefined;
			const workflowPromise = new Promise((resolve) => {
				resolveWorkflow = resolve;
			});

			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockReturnValue(workflowPromise),
				start: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.waitAll("payment", ctx.workflow("profile"));
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			// Workflow completes first
			resolveWorkflow?.({ name: "Max" });
			await new Promise((r) => setTimeout(r, 0));

			// Still waiting for signal
			expect(interpreter.state).toBe("waiting");

			// Now signal arrives
			interpreter.signal("payment", { card: "5678" });

			const result = await runPromise;
			expect(result).toEqual([{ card: "5678" }, { name: "Max" }]);
		});

		it("fails the workflow when a dependency workflow rejects in mixed waitAll", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi
					.fn()
					.mockRejectedValue(new Error("dependency failed")),
				start: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.waitAll("payment", ctx.workflow("profile"));
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("dependency failed");
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

		it("preserves stack trace on child_failed event", async () => {
			const childWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("explode", async () => {
					throw new Error("child boom");
				});
			};

			const parentWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.child("kid", childWorkflow);
			};

			const log = new EventLog();
			const interpreter = new Interpreter(parentWorkflow, log);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");

			const events = log.events();
			const childFailed = events.find((e) => e.type === "child_failed");
			expect(childFailed).toBeDefined();
			expect(childFailed?.type === "child_failed" && childFailed.stack).toMatch(
				/Error: child boom/,
			);
		});
	});

	describe("onStateChange", () => {
		it("supports multiple listeners", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const calls1: string[] = [];
			const calls2: string[] = [];

			interpreter.onStateChange(() => calls1.push("a"));
			interpreter.onStateChange(() => calls2.push("b"));

			await interpreter.run();

			expect(calls1.length).toBeGreaterThan(0);
			expect(calls2.length).toBeGreaterThan(0);
		});

		it("returns an unsubscribe function", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const calls: string[] = [];

			const unsub = interpreter.onStateChange(() => calls.push("called"));

			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			// Should have been called at least once (entering waiting state)
			const countBeforeUnsub = calls.length;
			expect(countBeforeUnsub).toBeGreaterThan(0);

			unsub();

			interpreter.signal("submit", "data");
			await runPromise;

			// Should not have received more calls after unsubscribe
			expect(calls.length).toBe(countBeforeUnsub);
		});
	});

	describe("error recovery", () => {
		it("workflow catches activity error and returns fallback value", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				try {
					yield* ctx.activity("fail", async () => {
						throw new Error("boom");
					});
					return "unreachable";
				} catch {
					return "fallback";
				}
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("fallback");
			expect(interpreter.state).toBe("completed");
		});

		it("workflow catches error, does a second activity, returns its result", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				try {
					yield* ctx.activity("fail", async () => {
						throw new Error("boom");
					});
					return "unreachable";
				} catch {
					const result = yield* ctx.activity(
						"recover",
						async () => "recovered",
					);
					return result;
				}
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("recovered");
			expect(interpreter.state).toBe("completed");

			const events = interpreter.events;
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "activity_failed",
					seq: 1,
					error: "boom",
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "activity_completed",
					seq: 2,
					result: "recovered",
				}),
			);
		});

		it("replay works correctly after caught activity error", async () => {
			const failFn = vi.fn().mockRejectedValue(new Error("boom"));
			const recoverFn = vi.fn().mockResolvedValue("recovered");

			const workflow: WorkflowFunction<string> = function* (ctx) {
				try {
					yield* ctx.activity("fail", failFn as () => Promise<string>);
					return "unreachable";
				} catch {
					const result = yield* ctx.activity(
						"recover",
						recoverFn as () => Promise<string>,
					);
					return result;
				}
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{ type: "activity_scheduled", name: "fail", seq: 1, timestamp: 2 },
				{
					type: "activity_failed",
					seq: 1,
					error: "boom",
					timestamp: 3,
				},
				{
					type: "activity_scheduled",
					name: "recover",
					seq: 2,
					timestamp: 4,
				},
				{
					type: "activity_completed",
					seq: 2,
					result: "recovered",
					timestamp: 5,
				},
				{
					type: "workflow_completed",
					result: "recovered",
					timestamp: 6,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("recovered");
			expect(interpreter.state).toBe("completed");
			expect(failFn).not.toHaveBeenCalled();
			expect(recoverFn).not.toHaveBeenCalled();
		});
	});

	describe("compacted fast path", () => {
		it("returns result immediately from compacted workflow_completed event", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", activityFn);
			};

			const log = new EventLog([
				{ type: "workflow_completed", result: "hello", timestamp: 4 },
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("hello");
			expect(interpreter.state).toBe("completed");
			expect(interpreter.result).toBe("hello");
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("sets failed state from compacted workflow_failed event", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", activityFn);
			};

			const log = new EventLog([
				{ type: "workflow_failed", error: "boom", timestamp: 4 },
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBeUndefined();
			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("boom");
			expect(activityFn).not.toHaveBeenCalled();
		});
	});

	describe("query", () => {
		it("registers a handler and returns its value", async () => {
			const workflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				Record<string, never>,
				{ greeting: string }
			> = function* (ctx) {
				ctx.query("greeting", () => "hi there");
				return yield* ctx.activity("greet", async () => "hello");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			await interpreter.run();

			expect(interpreter.query("greeting")).toBe("hi there");
		});

		it("handler captures workflow closure state", async () => {
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

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			// Handler should reflect current closure state
			expect(interpreter.query("count")).toBe(1);

			interpreter.signal("submit", "data");
			await runPromise;

			expect(interpreter.query("count")).toBe(2);
		});

		it("returns undefined for unregistered queries", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			await interpreter.run();

			expect(interpreter.query("nonexistent")).toBeUndefined();
		});

		it("handlers work during replay", async () => {
			const workflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				Record<string, never>,
				{ status: string }
			> = function* (ctx) {
				ctx.query("status", () => "registered");
				return yield* ctx.activity("greet", async () => "hello");
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{ type: "activity_scheduled", name: "greet", seq: 1, timestamp: 2 },
				{ type: "activity_completed", seq: 1, result: "hello", timestamp: 3 },
				{ type: "workflow_completed", result: "hello", timestamp: 4 },
			]);

			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			expect(interpreter.query("status")).toBe("registered");
		});
	});

	describe("events getter", () => {
		it("returns the event log entries", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			await interpreter.run();

			const events = interpreter.events;
			expect(events[0]).toMatchObject({ type: "workflow_started" });
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "activity_completed",
					result: "hello",
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({ type: "workflow_completed" }),
			);
		});
	});

	describe("Phase H: waitForWorkflow", () => {
		it("delegates to registry and returns the result", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("login-result"),
				start: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				const user = yield* ctx.waitForWorkflow("login");
				return `got: ${user}`;
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
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

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("login", { start: false });
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			await interpreter.run();

			expect(mockRegistry.waitFor).toHaveBeenCalledWith("login", {
				start: false,
			});
		});

		it("throws without a registry", async () => {
			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("login");
			};

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toContain("WorkflowRegistry");
		});

		it("records dependency_started and dependency_completed events", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("user-data"),
				start: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.waitForWorkflow("login");
			};

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
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

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				const user = yield* ctx.waitForWorkflow("login");
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

			const interpreter = new Interpreter(wf, log, mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("got: cached-user");
			expect(mockRegistry.waitFor).not.toHaveBeenCalled();
		});
	});

	describe("cancellation", () => {
		it("cancel() aborts in-flight activity and sets cancelled state", async () => {
			let activityStarted = false;
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity(
					"slow",
					() =>
						new Promise((resolve) => {
							activityStarted = true;
							setTimeout(() => resolve("done"), 5000);
						}),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(activityStarted).toBe(true);
			});

			interpreter.cancel();

			await runPromise;

			expect(interpreter.state).toBe("cancelled");
		});

		it("cancel() breaks out of waitFor and sets cancelled state", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.cancel();

			await runPromise;

			expect(interpreter.state).toBe("cancelled");
		});

		it("cancel() breaks out of sleep and sets cancelled state", async () => {
			vi.useFakeTimers();

			const workflow: WorkflowFunction<string> = function* (ctx) {
				yield* ctx.sleep(60000);
				return "done";
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			// Let the sleep start
			await vi.advanceTimersByTimeAsync(100);

			interpreter.cancel();

			await runPromise;

			expect(interpreter.state).toBe("cancelled");

			vi.useRealTimers();
		});

		it("cancel() is a no-op on completed workflows", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("completed");

			interpreter.cancel();

			expect(interpreter.state).toBe("completed");
			expect(interpreter.result).toBe("hello");
		});

		it("cancel() is a no-op on failed workflows", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("fail", async () => {
					throw new Error("boom");
				});
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");

			interpreter.cancel();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("boom");
		});

		it("cancelled workflow logs workflow_cancelled event", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const data = yield* ctx.waitFor<string>("submit");
				return `got: ${data}`;
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.cancel();

			await runPromise;

			expect(log.events()).toContainEqual(
				expect.objectContaining({ type: "workflow_cancelled" }),
			);
		});

		it("compacted fast path handles workflow_cancelled", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", activityFn);
			};

			const log = new EventLog([
				{ type: "workflow_cancelled", timestamp: 4 },
			]);

			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			expect(interpreter.state).toBe("cancelled");
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("activity receives AbortSignal that fires on cancel", async () => {
			let receivedSignal: AbortSignal | undefined;
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity(
					"slow",
					(signal) =>
						new Promise((resolve) => {
							receivedSignal = signal;
							setTimeout(() => resolve("done"), 5000);
						}),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(receivedSignal).toBeDefined();
			});

			expect(receivedSignal!.aborted).toBe(false);

			interpreter.cancel();

			await runPromise;

			expect(receivedSignal!.aborted).toBe(true);
		});
	});

	describe("Phase I: waitForAny", () => {
		it("pauses and resumes when any matching signal arrives", async () => {
			const workflow: WorkflowFunction<string, { add: string; remove: string }> =
				function* (ctx) {
					const { signal, payload } = yield* ctx.waitForAny("add", "remove");
					return `${signal}:${payload}`;
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("add", "item-1");

			const result = await runPromise;
			expect(result).toBe("add:item-1");
			expect(interpreter.state).toBe("completed");
		});

		it("returns { signal, payload } with correct discriminant", async () => {
			const workflow: WorkflowFunction<
				{ signal: string; payload: unknown },
				{ a: string; b: number }
			> = function* (ctx) {
				return yield* ctx.waitForAny("a", "b");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("b", 42);

			const result = await runPromise;
			expect(result).toEqual({ signal: "b", payload: 42 });
		});

		it("ignores signals not in the list", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string; c: string }> =
				function* (ctx) {
					const { signal } = yield* ctx.waitForAny("a", "b");
					return signal;
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("c", "ignored");

			// Should still be waiting
			expect(interpreter.state).toBe("waiting");
		});

		it("exposes waitingForAny getter", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const { signal } = yield* ctx.waitForAny("a", "b");
					return signal;
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingForAny).toEqual(["a", "b"]);
			});
		});

		it("replays from event log", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const { signal, payload } = yield* ctx.waitForAny("a", "b");
					return `${signal}:${payload}`;
				};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "signal_received",
					signal: "b",
					payload: "replayed",
					seq: 1,
					timestamp: 2,
				},
				{
					type: "workflow_completed",
					result: "b:replayed",
					timestamp: 3,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("b:replayed");
		});

		it("multiple sequential calls replay correctly", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const first = yield* ctx.waitForAny("a", "b");
					const second = yield* ctx.waitForAny("a", "b");
					return `${first.signal}-${second.signal}`;
				};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "signal_received",
					signal: "a",
					payload: "x",
					seq: 1,
					timestamp: 2,
				},
				{
					type: "signal_received",
					signal: "b",
					payload: "y",
					seq: 2,
					timestamp: 3,
				},
				{
					type: "workflow_completed",
					result: "a-b",
					timestamp: 4,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("a-b");
		});

		it("records signal_received event", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const { signal } = yield* ctx.waitForAny("a", "b");
					return signal;
				};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("a", "payload-a");
			await runPromise;

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "signal_received",
					signal: "a",
					payload: "payload-a",
					seq: 1,
				}),
			);
		});

		it("cancel breaks out of waiting", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const { signal } = yield* ctx.waitForAny("a", "b");
					return signal;
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.cancel();
			await runPromise;

			expect(interpreter.state).toBe("cancelled");
		});
	});

	describe("Phase J: on/done event loop", () => {
		it("dispatches to matching handler", async () => {
			const workflow: WorkflowFunction<string, { greet: string }> =
				function* (ctx) {
					let message = "";
					const result = yield* ctx.on<string>({
						greet: function* (ctx, name: string) {
							message = name;
							yield* ctx.done(message);
						},
					});
					return result;
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("greet", "Max");

			const result = await runPromise;
			expect(result).toBe("Max");
		});

		it("loops: handles multiple signals before done", async () => {
			const workflow: WorkflowFunction<number, { inc: undefined; finish: undefined }> =
				function* (ctx) {
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

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("inc");
			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("inc");
			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("finish");

			const result = await runPromise;
			expect(result).toBe(2);
		});

		it("done() exits loop and returns value", async () => {
			const workflow: WorkflowFunction<string, { stop: string }> =
				function* (ctx) {
					return yield* ctx.on<string>({
						stop: function* (ctx, value: string) {
							yield* ctx.done(value);
						},
					});
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("stop", "goodbye");

			const result = await runPromise;
			expect(result).toBe("goodbye");
		});

		it("handlers can yield commands (activity, sleep, etc.)", async () => {
			const workflow: WorkflowFunction<string, { go: undefined }> =
				function* (ctx) {
					return yield* ctx.on<string>({
						go: function* (ctx) {
							const result = yield* ctx.activity(
								"fetch",
								async () => "fetched",
							);
							yield* ctx.done(result);
						},
					});
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("go");

			const result = await runPromise;
			expect(result).toBe("fetched");
		});

		it("full loop replays from event log", async () => {
			const activityFn = vi.fn().mockResolvedValue("fetched");
			const workflow: WorkflowFunction<string, { inc: undefined; finish: undefined }> =
				function* (ctx) {
					let count = 0;
					return yield* ctx.on<string>({
						inc: function* (ctx) {
							yield* ctx.activity("count", activityFn);
							count++;
						},
						finish: function* (ctx) {
							yield* ctx.done(`total:${count}`);
						},
					});
				};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				// First iteration: inc
				{
					type: "signal_received",
					signal: "inc",
					payload: undefined,
					seq: 1,
					timestamp: 2,
				},
				{
					type: "activity_scheduled",
					name: "count",
					seq: 2,
					timestamp: 3,
				},
				{
					type: "activity_completed",
					seq: 2,
					result: "fetched",
					timestamp: 4,
				},
				// Second iteration: finish
				{
					type: "signal_received",
					signal: "finish",
					payload: undefined,
					seq: 3,
					timestamp: 5,
				},
				{
					type: "workflow_completed",
					result: "total:1",
					timestamp: 6,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("total:1");
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("handler error propagates as workflow failure", async () => {
			const workflow: WorkflowFunction<string, { go: undefined }> =
				function* (ctx) {
					return yield* ctx.on<string>({
						go: function* () {
							throw new Error("handler boom");
						},
					});
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("go");
			await runPromise;

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("handler boom");
		});

		it("unmatched signal is skipped (re-waits)", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					return yield* ctx.on<string>({
						a: function* (ctx, value: string) {
							yield* ctx.done(value);
						},
					});
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			// "b" is in the waitForAny list but has no handler — should be skipped
			interpreter.signal("b", "ignored");

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("a", "matched");

			const result = await runPromise;
			expect(result).toBe("matched");
		});
	});
});

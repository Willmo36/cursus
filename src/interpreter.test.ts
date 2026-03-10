// ABOUTME: Tests for the workflow interpreter runtime.
// ABOUTME: Covers activity execution, replay, signals, sleep, race, all, and child workflows.

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

	describe("Phase E: parallel activities via all()", () => {
		it("runs multiple activities concurrently and returns all results", async () => {
			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.all(
					ctx.activity("a", async () => "one"),
					ctx.activity("b", async () => "two"),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
		});

		it("replays parallel activities from event log", async () => {
			const fnA = vi.fn().mockResolvedValue("one");
			const fnB = vi.fn().mockResolvedValue("two");

			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.all(
					ctx.activity("a", fnA),
					ctx.activity("b", fnB),
				);
			};

			// seq 1 = activity "a", seq 2 = activity "b", seq 3 = all command
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "all_started",
					seq: 3,
					items: [{ type: "activity" }, { type: "activity" }],
					timestamp: 2,
				},
				{
					type: "all_completed",
					seq: 3,
					results: ["one", "two"],
					timestamp: 3,
				},
				{ type: "workflow_completed", result: ["one", "two"], timestamp: 4 },
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
			expect(fnA).not.toHaveBeenCalled();
			expect(fnB).not.toHaveBeenCalled();
		});

		it("fails the whole all() if one activity fails", async () => {
			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.all(
					ctx.activity("ok", async () => "fine"),
					ctx.activity("bad", async () => {
						throw new Error("oops");
					}),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("oops");
		});
	});

	describe("Phase F: all() with signals", () => {
		it("collects multiple signals in any order and returns tuple in declaration order", async () => {
			const workflow: WorkflowFunction<
				[string, string],
				{ email: string; password: string }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("email"),
					ctx.waitFor("password"),
				);
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

		it("records all_started and all_completed events", async () => {
			const workflow: WorkflowFunction<
				[string, string],
				{ a: string; b: string }
			> = function* (ctx) {
				return yield* ctx.all(ctx.waitFor("a"), ctx.waitFor("b"));
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
					type: "all_started",
					items: [{ type: "waitFor" }, { type: "waitFor" }],
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "all_completed",
					results: ["val-a", "val-b"],
				}),
			);
		});

		it("replays all() from event log", async () => {
			const workflow: WorkflowFunction<
				[string, number],
				{ name: string; age: number }
			> = function* (ctx) {
				return yield* ctx.all(ctx.waitFor("name"), ctx.waitFor("age"));
			};

			// seq 1 = waitFor "name", seq 2 = waitFor "age", seq 3 = all command
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "all_started",
					seq: 3,
					items: [{ type: "waitFor" }, { type: "waitFor" }],
					timestamp: 2,
				},
				{
					type: "all_completed",
					seq: 3,
					results: ["Max", 30],
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
				return yield* ctx.all(
					ctx.waitFor("email"),
					ctx.waitFor("password"),
				);
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

		it("collects signal and workflow result concurrently via all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockResolvedValue({ name: "Max" }),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("payment"),
					ctx.workflow("profile"),
				);
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
			expect(mockRegistry.waitForCompletion).toHaveBeenCalledWith("profile", {
				start: true,
				caller: undefined,
			});
		});

		it("records events for mixed signal + workflow all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockResolvedValue("profile-data"),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("payment"),
					ctx.workflow("profile"),
				);
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
					type: "all_started",
					items: [{ type: "waitFor" }, { type: "join" }],
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_started",
					workflowId: "profile",
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_completed",
					workflowId: "profile",
					result: "profile-data",
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "all_completed",
					results: ["pay-data", "profile-data"],
				}),
			);
		});

		it("throws without registry when all() has join items", async () => {
			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("payment"),
					ctx.workflow("profile"),
				);
			};

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toContain("WorkflowRegistry");
		});

		it("replays mixed all() from event log", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("payment"),
					ctx.workflow("profile"),
				);
			};

			// seq 1 = waitFor "payment", seq 2 = join "profile", seq 3 = all command
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "all_started",
					seq: 3,
					items: [{ type: "waitFor" }, { type: "join" }],
					timestamp: 2,
				},
				{
					type: "all_completed",
					seq: 3,
					results: [{ card: "1234" }, { name: "Max" }],
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
			expect(mockRegistry.waitForCompletion).not.toHaveBeenCalled();
		});

		it("handles signal arriving after workflow completes in all()", async () => {
			let resolveWorkflow: ((value: unknown) => void) | undefined;
			const workflowPromise = new Promise((resolve) => {
				resolveWorkflow = resolve;
			});

			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockReturnValue(workflowPromise),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("payment"),
					ctx.workflow("profile"),
				);
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

		it("fails the workflow when a dependency workflow rejects in all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi
					.fn()
					.mockRejectedValue(new Error("dependency failed")),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("payment"),
					ctx.workflow("profile"),
				);
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("dependency failed");
		});

		it("records workflow_dependency_failed when dependency fails in all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockRejectedValue(new Error("dep boom")),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("payment"),
					ctx.workflow("profile"),
				);
			};

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_failed",
					workflowId: "profile",
					error: "dep boom",
				}),
			);
			const failedEvent = events.find(
				(e) => e.type === "workflow_dependency_failed",
			);
			expect(
				failedEvent?.type === "workflow_dependency_failed" && failedEvent.stack,
			).toMatch(/Error: dep boom/);
		});

		it("cleans up waiting state on dependency failure in all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockRejectedValue(new Error("dep boom")),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				unknown,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("payment"),
					ctx.workflow("profile"),
				);
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.waitingForAll).toBeUndefined();
		});

		it("workflow can catch all() dependency failure and recover", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockRejectedValue(new Error("dep boom")),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ profile: unknown }
			> = function* (ctx) {
				try {
					yield* ctx.all(
						ctx.waitFor("payment"),
						ctx.workflow("profile"),
					);
					return "unreachable";
				} catch {
					return "recovered";
				}
			};

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("recovered");
			expect(interpreter.state).toBe("completed");
			expect(log.events()).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_failed",
					workflowId: "profile",
					error: "dep boom",
				}),
			);
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

	describe("published getter", () => {
		it("returns undefined before any publish", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			expect(interpreter.published).toBeUndefined();
			await interpreter.run();
			expect(interpreter.published).toBeUndefined();
		});

		it("returns last published value after executePublish", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const workflow: WorkflowFunction<
				string,
				{ submit: string },
				Record<string, never>,
				{ user: string }
			> = function* (ctx) {
				yield* ctx.publish({ user: "max" });
				return "done";
			};

			const interpreter = new Interpreter(
				workflow,
				new EventLog(),
				mockRegistry,
				"test",
			);
			await interpreter.run();

			expect(interpreter.published).toEqual({ user: "max" });
		});

		it("hydrates from replay (last workflow_published event)", async () => {
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "workflow_published",
					value: { user: "max" },
					seq: 1,
					timestamp: 2,
				},
				{
					type: "workflow_completed",
					result: "done",
					timestamp: 3,
				},
			]);

			const workflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				Record<string, never>,
				{ user: string }
			> = function* (ctx) {
				yield* ctx.publish({ user: "max" });
				return "done";
			};

			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			expect(interpreter.published).toEqual({ user: "max" });
		});
	});

	describe("Phase H: join (workflow dependency)", () => {
		it("delegates to registry and returns the result", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockResolvedValue("login-result"),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				const user = yield* ctx.join("login");
				return `got: ${user}`;
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("got: login-result");
			expect(mockRegistry.waitForCompletion).toHaveBeenCalledWith("login", {
				start: true,
				caller: undefined,
			});
		});

		it("passes start: false option to registry", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockResolvedValue("result"),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.join("login", { start: false });
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			await interpreter.run();

			expect(mockRegistry.waitForCompletion).toHaveBeenCalledWith("login", {
				start: false,
				caller: undefined,
			});
		});

		it("throws without a registry", async () => {
			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.join("login");
			};

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toContain("WorkflowRegistry");
		});

		it("records dependency_started and dependency_completed events", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockResolvedValue("user-data"),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.join("login");
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

		it("records workflow_dependency_failed event when dependency rejects", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi
					.fn()
					.mockRejectedValue(new Error("dependency failed")),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.join("login");
			};

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_failed",
					workflowId: "login",
					seq: 1,
					error: "dependency failed",
				}),
			);
			const failedEvent = events.find(
				(e) => e.type === "workflow_dependency_failed",
			);
			expect(
				failedEvent?.type === "workflow_dependency_failed" && failedEvent.stack,
			).toMatch(/Error: dependency failed/);
		});

		it("replays dependency failure from event log without calling registry", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.join("login");
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
					type: "workflow_dependency_failed",
					workflowId: "login",
					seq: 1,
					error: "dependency failed",
					timestamp: 3,
				},
				{
					type: "workflow_failed",
					error: "dependency failed",
					timestamp: 4,
				},
			]);

			const interpreter = new Interpreter(wf, log, mockRegistry);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("dependency failed");
			expect(mockRegistry.waitForCompletion).not.toHaveBeenCalled();
		});

		it("workflow can catch dependency failure and recover", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi
					.fn()
					.mockRejectedValue(new Error("dependency failed")),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				try {
					yield* ctx.join("login");
					return "unreachable";
				} catch {
					return "recovered";
				}
			};

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("recovered");
			expect(interpreter.state).toBe("completed");
			expect(log.events()).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_failed",
					workflowId: "login",
					seq: 1,
					error: "dependency failed",
				}),
			);
		});

		it("replays from event log without calling registry", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				const user = yield* ctx.join("login");
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
			expect(mockRegistry.waitForCompletion).not.toHaveBeenCalled();
		});
	});

	describe("ctx.published()", () => {
		it("resolves when dependency publishes a value", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn().mockResolvedValue({ user: "max" }),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ session: { user: string } }
			> = function* (ctx) {
				const account = yield* ctx.published("session");
				return `got: ${account}`;
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("got: [object Object]");
			expect(mockRegistry.waitForPublished).toHaveBeenCalledWith("session", {
				start: true,
				caller: undefined,
			});
		});

		it("records workflow_dependency_published event", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn().mockResolvedValue("published-data"),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.published("login");
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
					type: "workflow_dependency_published",
					workflowId: "login",
					seq: 1,
					result: "published-data",
				}),
			);
		});

		it("replays from workflow_dependency_published event", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				const user = yield* ctx.published("login");
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
					type: "workflow_dependency_published",
					workflowId: "login",
					seq: 1,
					result: "cached-pub",
					timestamp: 3,
				},
				{
					type: "workflow_completed",
					result: "got: cached-pub",
					timestamp: 4,
				},
			]);

			const interpreter = new Interpreter(wf, log, mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("got: cached-pub");
			expect(mockRegistry.waitForPublished).not.toHaveBeenCalled();
		});

		it("throws without a registry", async () => {
			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.published("login");
			};

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toContain("WorkflowRegistry");
		});

		it("passes start: false option to registry", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn().mockResolvedValue("result"),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.published("login", { start: false });
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			await interpreter.run();

			expect(mockRegistry.waitForPublished).toHaveBeenCalledWith("login", {
				start: false,
				caller: undefined,
			});
		});
	});

	describe("ctx.join()", () => {
		it("resolves when dependency completes", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockResolvedValue("final-result"),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ task: string }
			> = function* (ctx) {
				const result = yield* ctx.join("task");
				return `joined: ${result}`;
			};

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("joined: final-result");
			expect(mockRegistry.waitForCompletion).toHaveBeenCalledWith("task", {
				start: true,
				caller: undefined,
			});
		});

		it("records workflow_dependency_completed event", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockResolvedValue("join-data"),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.join("login");
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
					result: "join-data",
				}),
			);
		});

		it("replays from workflow_dependency_completed event", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				const user = yield* ctx.join("login");
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
			expect(mockRegistry.waitForCompletion).not.toHaveBeenCalled();
		});

		it("throws without a registry", async () => {
			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ login: string }
			> = function* (ctx) {
				return yield* ctx.join("login");
			};

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toContain("WorkflowRegistry");
		});

		it("records workflow_dependency_failed event on rejection", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockRejectedValue(new Error("join failed")),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const wf: WorkflowFunction<
				string,
				Record<string, unknown>,
				{ task: string }
			> = function* (ctx) {
				return yield* ctx.join("task");
			};

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(log.events()).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_failed",
					workflowId: "task",
					seq: 1,
					error: "join failed",
				}),
			);
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

			const log = new EventLog([{ type: "workflow_cancelled", timestamp: 4 }]);

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

	describe("Phase I: race with signals", () => {
		it("pauses and resumes when any matching signal arrives", async () => {
			const workflow: WorkflowFunction<
				string,
				{ add: string; remove: string }
			> = function* (ctx) {
				const result = yield* ctx.race(
					ctx.waitFor("add"),
					ctx.waitFor("remove"),
				);
				return result.winner === 0
					? `add:${result.value}`
					: `remove:${result.value}`;
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

		it("returns { winner, value } with correct discriminant", async () => {
			const workflow: WorkflowFunction<
				{ winner: number; value: unknown },
				{ a: string; b: number }
			> = function* (ctx) {
				return yield* ctx.race(ctx.waitFor("a"), ctx.waitFor("b"));
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("b", 42);

			const result = await runPromise;
			expect(result).toEqual({ winner: 1, value: 42 });
		});

		it("ignores signals not in the race", async () => {
			const workflow: WorkflowFunction<
				string,
				{ a: string; b: string; c: string }
			> = function* (ctx) {
				const { winner } = yield* ctx.race(
					ctx.waitFor("a"),
					ctx.waitFor("b"),
				);
				return winner === 0 ? "a" : "b";
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
					const { winner } = yield* ctx.race(
						ctx.waitFor("a"),
						ctx.waitFor("b"),
					);
					return winner === 0 ? "a" : "b";
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
					const result = yield* ctx.race(
						ctx.waitFor("a"),
						ctx.waitFor("b"),
					);
					return result.winner === 0
						? `a:${result.value}`
						: `b:${result.value}`;
				};

			// seq 1 = waitFor "a", seq 2 = waitFor "b", seq 3 = race command
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "race_started",
					seq: 3,
					items: [{ type: "waitFor" }, { type: "waitFor" }],
					timestamp: 2,
				},
				{
					type: "race_completed",
					seq: 3,
					winner: 1,
					value: "replayed",
					timestamp: 3,
				},
				{
					type: "workflow_completed",
					result: "b:replayed",
					timestamp: 4,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("b:replayed");
		});

		it("multiple sequential calls replay correctly", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const first = yield* ctx.race(
						ctx.waitFor("a"),
						ctx.waitFor("b"),
					);
					const second = yield* ctx.race(
						ctx.waitFor("a"),
						ctx.waitFor("b"),
					);
					const firstName = first.winner === 0 ? "a" : "b";
					const secondName = second.winner === 0 ? "a" : "b";
					return `${firstName}-${secondName}`;
				};

			// First race: seq 1=waitFor "a", seq 2=waitFor "b", seq 3=race
			// Second race: seq 4=waitFor "a", seq 5=waitFor "b", seq 6=race
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "race_started",
					seq: 3,
					items: [{ type: "waitFor" }, { type: "waitFor" }],
					timestamp: 2,
				},
				{
					type: "race_completed",
					seq: 3,
					winner: 0,
					value: "x",
					timestamp: 3,
				},
				{
					type: "race_started",
					seq: 6,
					items: [{ type: "waitFor" }, { type: "waitFor" }],
					timestamp: 4,
				},
				{
					type: "race_completed",
					seq: 6,
					winner: 1,
					value: "y",
					timestamp: 5,
				},
				{
					type: "workflow_completed",
					result: "a-b",
					timestamp: 6,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("a-b");
		});

		it("records race_started and race_completed events", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const { winner } = yield* ctx.race(
						ctx.waitFor("a"),
						ctx.waitFor("b"),
					);
					return winner === 0 ? "a" : "b";
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
					type: "race_started",
					items: [{ type: "waitFor" }, { type: "waitFor" }],
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "race_completed",
					winner: 0,
					value: "payload-a",
				}),
			);
		});

		it("cancel breaks out of waiting", async () => {
			const workflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const { winner } = yield* ctx.race(
						ctx.waitFor("a"),
						ctx.waitFor("b"),
					);
					return winner === 0 ? "a" : "b";
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
			const workflow: WorkflowFunction<string, { greet: string }> = function* (
				ctx,
			) {
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
			const workflow: WorkflowFunction<string, { stop: string }> = function* (
				ctx,
			) {
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
			const workflow: WorkflowFunction<string, { go: undefined }> = function* (
				ctx,
			) {
				return yield* ctx.on<string>({
					go: function* (ctx) {
						const result = yield* ctx.activity("fetch", async () => "fetched");
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
			const workflow: WorkflowFunction<
				string,
				{ inc: undefined; finish: undefined }
			> = function* (ctx) {
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

			// ctx.on() now uses ctx.race(ctx.waitFor(...)) internally.
			// Seq allocation: waitFor("inc")=1, waitFor("finish")=2, race=3
			// After first iteration handler: activity("count")=4
			// Second iteration: waitFor("inc")=5, waitFor("finish")=6, race=7
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				// First iteration: race picks "inc" (winner 0)
				{
					type: "race_started",
					seq: 3,
					items: [{ type: "waitFor" }, { type: "waitFor" }],
					timestamp: 2,
				},
				{
					type: "race_completed",
					seq: 3,
					winner: 0,
					value: undefined,
					timestamp: 3,
				},
				// Handler runs activity
				{
					type: "activity_scheduled",
					name: "count",
					seq: 4,
					timestamp: 4,
				},
				{
					type: "activity_completed",
					seq: 4,
					result: "fetched",
					timestamp: 5,
				},
				// Second iteration: race picks "finish" (winner 1)
				{
					type: "race_started",
					seq: 7,
					items: [{ type: "waitFor" }, { type: "waitFor" }],
					timestamp: 6,
				},
				{
					type: "race_completed",
					seq: 7,
					winner: 1,
					value: undefined,
					timestamp: 7,
				},
				{
					type: "workflow_completed",
					result: "total:1",
					timestamp: 8,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toBe("total:1");
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("handler error propagates as workflow failure", async () => {
			const workflow: WorkflowFunction<string, { go: undefined }> = function* (
				ctx,
			) {
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

			// "b" is in the signal map but has no handler — should be skipped
			interpreter.signal("b", "ignored");

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("a", "matched");

			const result = await runPromise;
			expect(result).toBe("matched");
		});
	});

	describe("Phase G.2: child signal routing", () => {
		it("delegates signal to child workflow", async () => {
			const childWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					const val = yield* ctx.waitFor("data");
					return `child got: ${val}`;
				};

			const parentWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					const result = yield* ctx.child("sub", childWorkflow);
					return `parent got: ${result}`;
				};

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("data", "hello");

			const result = await runPromise;
			expect(result).toBe("parent got: child got: hello");
			expect(interpreter.state).toBe("completed");
		});

		it("parent reports child's waitingFor", async () => {
			const childWorkflow: WorkflowFunction<string, { info: string }> =
				function* (ctx) {
					const val = yield* ctx.waitFor("info");
					return `got: ${val}`;
				};

			const parentWorkflow: WorkflowFunction<string, { info: string }> =
				function* (ctx) {
					return yield* ctx.child("sub", childWorkflow);
				};

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingFor).toBe("info");
			});
		});

		it("parent reports child's waitingForAll", async () => {
			const childWorkflow: WorkflowFunction<
				[string, string],
				{ a: string; b: string }
			> = function* (ctx) {
				return yield* ctx.all(ctx.waitFor("a"), ctx.waitFor("b"));
			};

			const parentWorkflow: WorkflowFunction<
				[string, string],
				{ a: string; b: string }
			> = function* (ctx) {
				return yield* ctx.child("sub", childWorkflow);
			};

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingForAll).toEqual(["a", "b"]);
			});
		});

		it("parent reports child's waitingForAny", async () => {
			const childWorkflow: WorkflowFunction<string, { x: string; y: string }> =
				function* (ctx) {
					const { winner, value } = yield* ctx.race(
						ctx.waitFor("x"),
						ctx.waitFor("y"),
					);
					return winner === 0 ? `x:${value}` : `y:${value}`;
				};

			const parentWorkflow: WorkflowFunction<string, { x: string; y: string }> =
				function* (ctx) {
					return yield* ctx.child("sub", childWorkflow);
				};

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingForAny).toEqual(["x", "y"]);
			});
		});

		it("delegates signal through nested grandchild", async () => {
			const grandchild: WorkflowFunction<string, { deep: string }> = function* (
				ctx,
			) {
				const val = yield* ctx.waitFor("deep");
				return `grandchild: ${val}`;
			};

			const child: WorkflowFunction<string, { deep: string }> = function* (
				ctx,
			) {
				return yield* ctx.child("grandchild", grandchild);
			};

			const parent: WorkflowFunction<string, { deep: string }> = function* (
				ctx,
			) {
				return yield* ctx.child("child", child);
			};

			const interpreter = new Interpreter(parent, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingFor).toBe("deep");
			});

			interpreter.signal("deep", "value");

			const result = await runPromise;
			expect(result).toBe("grandchild: value");
		});

		it("cancel propagates to active child", async () => {
			const childWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					const val = yield* ctx.waitFor("data");
					return `got: ${val}`;
				};

			const parentWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					return yield* ctx.child("sub", childWorkflow);
				};

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.cancel();
			await runPromise;

			expect(interpreter.state).toBe("cancelled");
		});

		it("signal is harmless when child is running an activity", async () => {
			let resolveActivity: ((value: string) => void) | undefined;
			const childWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity(
					"slow",
					() =>
						new Promise<string>((resolve) => {
							resolveActivity = resolve;
						}),
				);
			};

			const parentWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.child("sub", childWorkflow);
			};

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(resolveActivity).toBeDefined();
			});

			// Signal while child is running (not waiting) — should not crash
			interpreter.signal("anything", "ignored");

			resolveActivity!("done");

			const result = await runPromise;
			expect(result).toBe("done");
			expect(interpreter.state).toBe("completed");
		});
	});

	describe("Phase K: race", () => {
		it("resolves with the activity when it beats the sleep", async () => {
			vi.useFakeTimers();

			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.activity("fast", async () => "data"),
					ctx.sleep(5000),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toEqual({ winner: 0, value: "data" });
			expect(interpreter.state).toBe("completed");

			vi.useRealTimers();
		});

		it("resolves with the sleep when the activity is slow", async () => {
			vi.useFakeTimers();

			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.activity(
						"slow",
						(signal) =>
							new Promise<string>((resolve, reject) => {
								const timer = setTimeout(() => resolve("late"), 10000);
								signal.addEventListener(
									"abort",
									() => {
										clearTimeout(timer);
										reject(signal.reason);
									},
									{ once: true },
								);
							}),
					),
					ctx.sleep(100),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.advanceTimersByTimeAsync(100);
			const result = await runPromise;

			expect(result).toEqual({ winner: 1, value: undefined });
			expect(interpreter.state).toBe("completed");

			vi.useRealTimers();
		});

		it("records race_started and race_completed events", async () => {
			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.activity("fetch", async () => "data"),
					ctx.sleep(5000),
				);
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "race_started",
					seq: 3,
					items: [{ type: "activity" }, { type: "sleep" }],
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "race_completed",
					seq: 3,
					winner: 0,
					value: "data",
				}),
			);
		});

		it("replays from event log without executing activities", async () => {
			const activityFn = vi
				.fn<(signal: AbortSignal) => Promise<string>>()
				.mockResolvedValue("data");
			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.activity("fetch", activityFn),
					ctx.sleep(5000),
				);
			};

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "race_started",
					seq: 3,
					items: [{ type: "activity" }, { type: "sleep" }],
					timestamp: 2,
				},
				{
					type: "race_completed",
					seq: 3,
					winner: 0,
					value: "data",
					timestamp: 3,
				},
				{
					type: "workflow_completed",
					result: { winner: 0, value: "data" },
					timestamp: 4,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toEqual({ winner: 0, value: "data" });
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("aborts the losing activity when sleep wins", async () => {
			vi.useFakeTimers();

			let receivedSignal: AbortSignal | undefined;
			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.activity(
						"slow",
						(signal) =>
							new Promise<string>((resolve, reject) => {
								receivedSignal = signal;
								const timer = setTimeout(() => resolve("late"), 10000);
								signal.addEventListener(
									"abort",
									() => {
										clearTimeout(timer);
										reject(signal.reason);
									},
									{ once: true },
								);
							}),
					),
					ctx.sleep(100),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.advanceTimersByTimeAsync(100);
			await runPromise;

			expect(receivedSignal).toBeDefined();
			expect(receivedSignal!.aborted).toBe(true);

			vi.useRealTimers();
		});

		it("races activity against waitFor signal", async () => {
			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: string },
				{ manual: string }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.activity(
						"auto",
						() =>
							new Promise<string>((resolve) =>
								setTimeout(() => resolve("auto-result"), 5000),
							),
					),
					ctx.waitFor("manual"),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("manual", "manual-result");

			const result = await runPromise;
			expect(result).toEqual({ winner: 1, value: "manual-result" });
		});

		it("workflow can branch on winner index", async () => {
			const workflow: WorkflowFunction<string> = function* (ctx) {
				const result = yield* ctx.race(
					ctx.activity("fetch", async () => "data"),
					ctx.sleep(5000),
				);
				if (result.winner === 0) {
					return `ok: ${result.value}`;
				}
				return "timeout";
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("ok: data");
		});

		it("cancel() cleans up all race branches", async () => {
			vi.useFakeTimers();

			let activitySignal: AbortSignal | undefined;
			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.activity(
						"slow",
						(signal) =>
							new Promise<string>((resolve) => {
								activitySignal = signal;
								setTimeout(() => resolve("done"), 10000);
							}),
					),
					ctx.sleep(5000),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.advanceTimersByTimeAsync(100);

			interpreter.cancel();
			await runPromise;

			expect(interpreter.state).toBe("cancelled");
			expect(activitySignal?.aborted).toBe(true);

			vi.useRealTimers();
		});

		it("races two waitFor branches — first signal received wins", async () => {
			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: string },
				{ approve: string; reject: string }
			> = function* (ctx) {
				return yield* ctx.race(ctx.waitFor("approve"), ctx.waitFor("reject"));
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("reject", "denied");

			const result = await runPromise;
			expect(result).toEqual({ winner: 1, value: "denied" });
			expect(interpreter.state).toBe("completed");
		});

		it("races three waitFor branches — third signal wins", async () => {
			const workflow: WorkflowFunction<
				| { winner: 0; value: string }
				| { winner: 1; value: string }
				| { winner: 2; value: string },
				{ single: string; optA: string; optB: string }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.waitFor("single"),
					ctx.waitFor("optA"),
					ctx.waitFor("optB"),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("optB", "picked-B");

			const result = await runPromise;
			expect(result).toEqual({
				winner: 2,
				value: "picked-B",
			});
		});

		it("races activity against child (child waits for signal)", async () => {
			const childWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					const val = yield* ctx.waitFor("data");
					return `child got: ${val}`;
				};

			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: string },
				{ data: string }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.activity(
						"slow",
						() =>
							new Promise<string>((resolve) =>
								setTimeout(() => resolve("auto"), 10000),
							),
					),
					ctx.child("sub", childWorkflow),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("data", "hello");

			const result = await runPromise;
			expect(result).toEqual({
				winner: 1,
				value: "child got: hello",
			});
		});

		it("races all against sleep", async () => {
			vi.useFakeTimers();

			const workflow: WorkflowFunction<
				{ winner: 0; value: string[] } | { winner: 1; value: void }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.all(
						ctx.activity("a", async () => "one"),
						ctx.activity("b", async () => "two"),
					),
					ctx.sleep(5000),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toEqual({ winner: 0, value: ["one", "two"] });

			vi.useRealTimers();
		});

		it("races join against sleep", async () => {
			vi.useFakeTimers();

			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockResolvedValue("workflow-result"),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void },
				Record<string, unknown>,
				{ dep: string }
			> = function* (ctx) {
				return yield* ctx.race(ctx.join("dep"), ctx.sleep(5000));
			};

			const interpreter = new Interpreter(
				workflow,
				new EventLog(),
				mockRegistry,
			);
			const result = await interpreter.run();

			expect(result).toEqual({ winner: 0, value: "workflow-result" });

			vi.useRealTimers();
		});

		it("cancel cleans up child in race", async () => {
			const childWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					const val = yield* ctx.waitFor("data");
					return `got: ${val}`;
				};

			const workflow: WorkflowFunction<
				{ winner: 0; value: void } | { winner: 1; value: string },
				{ data: string }
			> = function* (ctx) {
				return yield* ctx.race(
					ctx.sleep(5000),
					ctx.child("sub", childWorkflow),
				);
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

		it("exposes all signal names via waitingForAny during multi-signal race", async () => {
			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: string },
				{ approve: string; reject: string }
			> = function* (ctx) {
				return yield* ctx.race(ctx.waitFor("approve"), ctx.waitFor("reject"));
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingForAny).toEqual(
					expect.arrayContaining(["approve", "reject"]),
				);
			});
		});

		it("races waitFor against sleep — signal wins", async () => {
			vi.useFakeTimers();

			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void },
				{ approve: string }
			> = function* (ctx) {
				return yield* ctx.race(ctx.waitFor("approve"), ctx.sleep(5000));
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("approve", "approved-by-manager");

			const result = await runPromise;
			expect(result).toEqual({ winner: 0, value: "approved-by-manager" });
			expect(interpreter.state).toBe("completed");

			vi.useRealTimers();
		});

		it("races waitFor against sleep — timeout wins", async () => {
			vi.useFakeTimers();

			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void },
				{ approve: string }
			> = function* (ctx) {
				return yield* ctx.race(ctx.waitFor("approve"), ctx.sleep(100));
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.advanceTimersByTimeAsync(100);
			const result = await runPromise;

			expect(result).toEqual({ winner: 1, value: undefined });
			expect(interpreter.state).toBe("completed");

			vi.useRealTimers();
		});

		it("races waitFor against sleep — replays from event log", async () => {
			vi.useFakeTimers();

			const workflow: WorkflowFunction<
				{ winner: 0; value: string } | { winner: 1; value: void },
				{ approve: string }
			> = function* (ctx) {
				return yield* ctx.race(ctx.waitFor("approve"), ctx.sleep(5000));
			};

			// First run: signal wins
			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("approve", "yes");
			const firstResult = await runPromise;
			expect(firstResult).toEqual({ winner: 0, value: "yes" });

			// Replay from recorded events
			const replayLog = new EventLog(log.events());
			const replayed = new Interpreter(workflow, replayLog);
			const replayResult = await replayed.run();

			expect(replayResult).toEqual({ winner: 0, value: "yes" });
			expect(replayed.state).toBe("completed");

			vi.useRealTimers();
		});
	});

	describe("Profunctor: signal routing through combinators", () => {
		it("on handler calling ctx.child with waitFor receives signal", async () => {
			const childWorkflow: WorkflowFunction<string, { input: string }> =
				function* (ctx) {
					const val = yield* ctx.waitFor("input");
					return `child: ${val}`;
				};

			const workflow: WorkflowFunction<
				string,
				{ go: undefined; input: string }
			> = function* (ctx) {
				return yield* ctx.on<string>({
					go: function* (ctx) {
						const result = yield* ctx.child("sub", childWorkflow);
						yield* ctx.done(result);
					},
				});
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			// Send "go" to enter the handler
			interpreter.signal("go");

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingFor).toBe("input");
			});

			// Send "input" which should route through to the child
			interpreter.signal("input", "hello");

			const result = await runPromise;
			expect(result).toBe("child: hello");
		});

		it("race with multiple waitFor routes signal to correct branch", async () => {
			const workflow: WorkflowFunction<
				string,
				{ approve: string; reject: string }
			> = function* (ctx) {
				const { winner, value } = yield* ctx.race(
					ctx.waitFor("approve"),
					ctx.waitFor("reject"),
				);
				return winner === 0 ? `approved: ${value}` : `rejected: ${value}`;
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("approve", "ok");

			const result = await runPromise;
			expect(result).toBe("approved: ok");
		});

		it("test runtime delivers signals into child workflows", async () => {
			const childWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					const val = yield* ctx.waitFor("data");
					return `child: ${val}`;
				};

			const parentWorkflow: WorkflowFunction<string, { data: string }> =
				function* (ctx) {
					return yield* ctx.child("sub", childWorkflow);
				};

			const log = new EventLog();
			const interpreter = new Interpreter(parentWorkflow, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingFor).toBe("data");
			});

			interpreter.signal("data", "hello");

			const result = await runPromise;
			expect(result).toBe("child: hello");
		});

		it("nested child in on handler routes signals through full chain", async () => {
			const grandchild: WorkflowFunction<string, { value: string }> =
				function* (ctx) {
					const val = yield* ctx.waitFor("value");
					return `deep: ${val}`;
				};

			const child: WorkflowFunction<string, { value: string }> = function* (
				ctx,
			) {
				return yield* ctx.child("grandchild", grandchild);
			};

			const workflow: WorkflowFunction<
				string,
				{ start: undefined; value: string }
			> = function* (ctx) {
				return yield* ctx.on<string>({
					start: function* (ctx) {
						const result = yield* ctx.child("child", child);
						yield* ctx.done(result);
					},
				});
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("start");

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingFor).toBe("value");
			});

			interpreter.signal("value", "deep-data");

			const result = await runPromise;
			expect(result).toBe("deep: deep-data");
		});

		it("child with race routes correct signal", async () => {
			const childWorkflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					const { winner, value } = yield* ctx.race(
						ctx.waitFor("a"),
						ctx.waitFor("b"),
					);
					return winner === 0 ? `a:${value}` : `b:${value}`;
				};

			const parentWorkflow: WorkflowFunction<string, { a: string; b: string }> =
				function* (ctx) {
					return yield* ctx.child("sub", childWorkflow);
				};

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingForAny).toEqual(["a", "b"]);
			});

			interpreter.signal("b", "bee");

			const result = await runPromise;
			expect(result).toBe("b:bee");
		});
	});

	describe("Phase L: all", () => {
		it("collects multiple signals and returns tuple in order", async () => {
			const workflow: WorkflowFunction<
				[string, string],
				{ a: string; b: string }
			> = function* (ctx) {
				return yield* ctx.all(ctx.waitFor("a"), ctx.waitFor("b"));
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			// Send in reverse order
			interpreter.signal("b", "val-b");

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("a", "val-a");

			const result = await runPromise;
			expect(result).toEqual(["val-a", "val-b"]);
			expect(interpreter.state).toBe("completed");
		});

		it("runs concurrent activities and returns all results", async () => {
			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.all(
					ctx.activity("a", async () => "one"),
					ctx.activity("b", async () => "two"),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
			expect(interpreter.state).toBe("completed");
		});

		it("mixes signal and activity in same all() call", async () => {
			const workflow: WorkflowFunction<[string, string], { name: string }> =
				function* (ctx) {
					return yield* ctx.all(
						ctx.waitFor("name"),
						ctx.activity("greet", async () => "hello"),
					);
				};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("name", "Max");

			const result = await runPromise;
			expect(result).toEqual(["Max", "hello"]);
		});

		it("records all_started and all_completed events", async () => {
			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.all(
					ctx.activity("a", async () => "one"),
					ctx.activity("b", async () => "two"),
				);
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "all_started",
					items: [{ type: "activity" }, { type: "activity" }],
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "all_completed",
					results: ["one", "two"],
				}),
			);
		});

		it("replays from event log", async () => {
			const fnA = vi.fn().mockResolvedValue("one");
			const fnB = vi.fn().mockResolvedValue("two");

			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.all(ctx.activity("a", fnA), ctx.activity("b", fnB));
			};

			// seq 1 = activity "a", seq 2 = activity "b", seq 3 = all command
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "all_started",
					seq: 3,
					items: [{ type: "activity" }, { type: "activity" }],
					timestamp: 2,
				},
				{
					type: "all_completed",
					seq: 3,
					results: ["one", "two"],
					timestamp: 3,
				},
				{
					type: "workflow_completed",
					result: ["one", "two"],
					timestamp: 4,
				},
			]);

			const interpreter = new Interpreter(workflow, log);
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
			expect(fnA).not.toHaveBeenCalled();
			expect(fnB).not.toHaveBeenCalled();
		});

		it("cancel cleans up all branches", async () => {
			let activityStarted = false;
			const workflow: WorkflowFunction<[string, string], { sig: string }> =
				function* (ctx) {
					return yield* ctx.all(
						ctx.waitFor("sig"),
						ctx.activity(
							"slow",
							() =>
								new Promise<string>((resolve) => {
									activityStarted = true;
									setTimeout(() => resolve("done"), 5000);
								}),
						),
					);
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

		it("mixes signal and workflow join in all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn().mockResolvedValue({ name: "Max" }),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const workflow: WorkflowFunction<
				unknown,
				{ payment: string },
				{ profile: unknown }
			> = function* (ctx) {
				return yield* ctx.all(ctx.waitFor("payment"), ctx.join("profile"));
			};

			const interpreter = new Interpreter(
				workflow,
				new EventLog(),
				mockRegistry,
			);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("payment", { card: "1234" });

			const result = await runPromise;
			expect(result).toEqual([{ card: "1234" }, { name: "Max" }]);
			expect(interpreter.state).toBe("completed");
		});

		it("signals reach the correct waitFor branch", async () => {
			const workflow: WorkflowFunction<
				[string, string, string],
				{ a: string; b: string; c: string }
			> = function* (ctx) {
				return yield* ctx.all(
					ctx.waitFor("a"),
					ctx.waitFor("b"),
					ctx.waitFor("c"),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			// Send out of order
			interpreter.signal("c", "C");

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("a", "A");

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
			});

			interpreter.signal("b", "B");

			const result = await runPromise;
			expect(result).toEqual(["A", "B", "C"]);
		});

		it("exposes waitingForAll with remaining signal names", async () => {
			const workflow: WorkflowFunction<
				[string, string],
				{ x: string; y: string }
			> = function* (ctx) {
				return yield* ctx.all(ctx.waitFor("x"), ctx.waitFor("y"));
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.state).toBe("waiting");
				expect(interpreter.waitingForAll).toEqual(["x", "y"]);
			});

			interpreter.signal("x", "val-x");

			await vi.waitFor(() => {
				expect(interpreter.waitingForAll).toEqual(["y"]);
			});
		});

		it("fails the whole all() when one activity fails", async () => {
			const workflow: WorkflowFunction<[string, string]> = function* (ctx) {
				return yield* ctx.all(
					ctx.activity("ok", async () => "fine"),
					ctx.activity("bad", async () => {
						throw new Error("oops");
					}),
				);
			};

			const interpreter = new Interpreter(workflow, new EventLog());
			await interpreter.run();

			expect(interpreter.state).toBe("failed");
			expect(interpreter.error).toBe("oops");
		});
	});

	describe("Event observers", () => {
		it("observer on EventLog receives all events from a workflow run", async () => {
			const observed: import("./types").WorkflowEvent[] = [];
			const log = new EventLog([], (event) => observed.push(event));

			const workflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("greet", async () => "hello");
			};

			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			const types = observed.map((e) => e.type);
			expect(types).toEqual([
				"workflow_started",
				"activity_scheduled",
				"activity_completed",
				"workflow_completed",
			]);
		});

		it("observers array on Interpreter fires for child workflow events", async () => {
			type ObservedEntry = {
				workflowId: string;
				event: import("./types").WorkflowEvent;
			};
			const observed: ObservedEntry[] = [];
			const observer = (wid: string, event: import("./types").WorkflowEvent) =>
				observed.push({ workflowId: wid, event });

			const childWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.activity("childTask", async () => "child-result");
			};

			const parentWorkflow: WorkflowFunction<string> = function* (ctx) {
				return yield* ctx.child("sub", childWorkflow);
			};

			const log = new EventLog();
			const interpreter = new Interpreter(
				parentWorkflow,
				log,
				undefined,
				undefined,
				[observer],
			);
			await interpreter.run();

			// Child events should have been observed with the child's workflow ID
			const childEvents = observed.filter((o) => o.workflowId === "sub");
			const childTypes = childEvents.map((o) => o.event.type);
			expect(childTypes).toContain("workflow_started");
			expect(childTypes).toContain("activity_scheduled");
			expect(childTypes).toContain("activity_completed");
			expect(childTypes).toContain("workflow_completed");
		});
	});

	describe("Phase L: publish", () => {
		it("records workflow_published event", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const workflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				Record<string, never>,
				string
			> = function* (ctx) {
				yield* ctx.publish("account-123");
				return "done";
			};

			const log = new EventLog();
			const interpreter = new Interpreter(
				workflow,
				log,
				mockRegistry,
				"session",
			);
			await interpreter.run();

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_published",
					value: "account-123",
					seq: 1,
				}),
			);
		});

		it("calls registry.publish with workflow ID and value", async () => {
			const publishFn = vi.fn();
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: publishFn,
			};

			const workflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				Record<string, never>,
				string
			> = function* (ctx) {
				yield* ctx.publish("account-123");
				return "done";
			};

			const interpreter = new Interpreter(
				workflow,
				new EventLog(),
				mockRegistry,
				"session",
			);
			await interpreter.run();

			expect(publishFn).toHaveBeenCalledWith("session", "account-123");
		});

		it("workflow continues executing after publish", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			};

			const workflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				Record<string, never>,
				string
			> = function* (ctx) {
				yield* ctx.publish("account-123");
				const result = yield* ctx.activity("doMore", async () => "extra");
				return result;
			};

			const interpreter = new Interpreter(
				workflow,
				new EventLog(),
				mockRegistry,
				"session",
			);
			const result = await interpreter.run();

			expect(result).toBe("extra");
			expect(interpreter.state).toBe("completed");
		});

		it("replays publish from event log without calling registry", async () => {
			const publishFn = vi.fn();
			const mockRegistry: WorkflowRegistryInterface = {
				waitForPublished: vi.fn(),
				waitForCompletion: vi.fn(),
				start: vi.fn(),
				publish: publishFn,
			};

			const workflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				Record<string, never>,
				string
			> = function* (ctx) {
				yield* ctx.publish("account-123");
				return "done";
			};

			// Pre-populate log with the publish event (replay scenario)
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "workflow_published",
					value: "account-123",
					seq: 1,
					timestamp: 2,
				},
				{ type: "workflow_completed", result: "done", timestamp: 3 },
			]);

			const interpreter = new Interpreter(
				workflow,
				log,
				mockRegistry,
				"session",
			);
			await interpreter.run();

			expect(publishFn).not.toHaveBeenCalled();
		});

		it("works without registry (sets published value locally)", async () => {
			const workflow: WorkflowFunction<
				string,
				Record<string, unknown>,
				Record<string, never>,
				string
			> = function* (ctx) {
				yield* ctx.publish("account-123");
				return "done";
			};

			const log = new EventLog();
			const interpreter = new Interpreter(workflow, log);
			await interpreter.run();

			expect(interpreter.state).toBe("completed");
			expect(interpreter.published).toBe("account-123");
		});
	});
});

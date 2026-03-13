// ABOUTME: Tests for the workflow interpreter runtime.
// ABOUTME: Covers activity execution, replay, signals, sleep, race, all, and child workflows.

import { describe, expect, it, vi } from "vitest";
import { EventLog } from "./event-log";
import { Interpreter } from "./interpreter";
import { activity, all, child, handler, loop, loopBreak, output, publish, race, receive, sleep, workflow } from "./types";
import type { WorkflowRegistryInterface } from "./types";

describe("Interpreter", () => {
	describe("Phase A: basic activity execution", () => {
		it("runs a workflow that yields one activity and gets the result", async () => {
			const wf = workflow(function* () {
				const result = yield* activity("greet", async () => "hello");
				return result;
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("hello");
			expect(interpreter.status).toBe("completed");
		});

		it("runs a workflow that yields two sequential activities", async () => {
			const wf = workflow(function* () {
				const a = yield* activity("first", async () => "one");
				const b = yield* activity("second", async () => "two");
				return `${a}-${b}`;
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("one-two");
		});

		it("records activity events in the log", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
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
			const wf = workflow(function* () {
				return yield* activity("fail", async () => {
					throw new Error("boom");
				});
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
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
			const wf = workflow(function* () {
				return yield* activity("fail", async () => {
					throw new Error("boom");
				});
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
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
			const wf = workflow(function* () {
				return yield* activity("fail", async () => {
					throw "string error";
				});
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
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
			const wf = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{ type: "activity_scheduled", name: "greet", seq: 1, timestamp: 2 },
				{ type: "activity_completed", seq: 1, result: "hello", timestamp: 3 },
				{ type: "workflow_completed", result: "hello", timestamp: 4 },
			]);

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe("hello");
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("transitions from replay to live execution when log is exhausted", async () => {
			const liveFn = vi.fn().mockResolvedValue("live-result");
			const wf = workflow(function* () {
				const a = yield* activity("first", async () => "replayed");
				const b = yield* activity("second", liveFn);
				return `${a}-${b}`;
			});

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

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe("replayed-live-result");
			expect(liveFn).toHaveBeenCalledOnce();
		});

		it("detects non-determinism when command does not match event", async () => {
			const wf = workflow(function* () {
				return yield* activity("different-name", async () => "x");
			});

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

			const interpreter = new Interpreter(wf, log);
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toContain("Non-determinism detected");
		});
	});

	describe("Phase C: signals (receive)", () => {
		it("pauses on receive and resumes when signal is received", async () => {
			const wf = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			// Should be waiting after run starts
			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receiving).toBe("submit");
			});

			interpreter.signal("submit", "form-data");

			const result = await runPromise;
			expect(result).toBe("got: form-data");
			expect(interpreter.status).toBe("completed");
		});

		it("replays signal from event log", async () => {
			const wf = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

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

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe("got: saved-data");
		});

		it("handles multiple sequential receive calls", async () => {
			const wf = workflow(function* () {
				const email = yield* receive<string>("email");
				const password = yield* receive<string>("password");
				return `${email}:${password}`;
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.receiving).toBe("email");
			});

			interpreter.signal("email", "test@example.com");

			await vi.waitFor(() => {
				expect(interpreter.receiving).toBe("password");
			});

			interpreter.signal("password", "secret");

			const result = await runPromise;
			expect(result).toBe("test@example.com:secret");
		});
	});

	describe("Phase D: sleep", () => {
		it("pauses for the specified duration then resumes", async () => {
			vi.useFakeTimers();

			const wf = workflow(function* () {
				yield* sleep(1000);
				return "done";
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const runPromise = interpreter.run();

			// Timer should be started but not fired
			await vi.advanceTimersByTimeAsync(500);
			expect(interpreter.status).toBe("running");

			await vi.advanceTimersByTimeAsync(500);
			const result = await runPromise;

			expect(result).toBe("done");
			expect(interpreter.status).toBe("completed");

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
			const wf = workflow(function* () {
				yield* sleep(1000);
				return "done";
			});

			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{ type: "timer_started", seq: 1, durationMs: 1000, timestamp: 2 },
				{ type: "timer_fired", seq: 1, timestamp: 1003 },
				{ type: "workflow_completed", result: "done", timestamp: 1004 },
			]);

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe("done");
		});
	});

	describe("Phase E: parallel activities via all()", () => {
		it("runs multiple activities concurrently and returns all results", async () => {
			const wf = workflow(function* () {
				return yield* all(
					activity("a", async () => "one"),
					activity("b", async () => "two"),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
		});

		it("replays parallel activities from event log", async () => {
			const fnA = vi.fn().mockResolvedValue("one");
			const fnB = vi.fn().mockResolvedValue("two");

			const wf = workflow(function* () {
				return yield* all(activity("a", fnA), activity("b", fnB));
			});

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

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
			expect(fnA).not.toHaveBeenCalled();
			expect(fnB).not.toHaveBeenCalled();
		});

		it("fails the whole all() if one activity fails", async () => {
			const wf = workflow(function* () {
				return yield* all(
					activity("ok", async () => "fine"),
					activity("bad", async () => {
						throw new Error("oops");
					}),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toBe("oops");
		});
	});

	describe("Phase F: all() with signals", () => {
		it("collects multiple signals in any order and returns tuple in declaration order", async () => {
			const wf = workflow(function* () {
				return yield* all(receive("email"), receive("password"));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			// Send in reverse order
			interpreter.signal("password", "secret");

			// Should still be waiting for email
			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("email", "a@b.com");

			const result = await runPromise;
			// Tuple in declaration order regardless of signal arrival order
			expect(result).toEqual(["a@b.com", "secret"]);
			expect(interpreter.status).toBe("completed");
		});

		it("records all_started and all_completed events", async () => {
			const wf = workflow(function* () {
				return yield* all(receive("a"), receive("b"));
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("a", "val-a");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("b", "val-b");
			await runPromise;

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "all_started",
					items: [{ type: "receive" }, { type: "receive" }],
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
			const wf = workflow(function* () {
				return yield* all(receive("name"), receive("age"));
			});

			// seq 1 = receive "name", seq 2 = receive "age", seq 3 = all command
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "all_started",
					seq: 3,
					items: [{ type: "receive" }, { type: "receive" }],
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

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toEqual(["Max", 30]);
		});

		it("exposes waitingForAll with remaining signal names", async () => {
			const wf = workflow(function* () {
				return yield* all(receive("email"), receive("password"));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receivingAll).toEqual(["email", "password"]);
			});

			interpreter.signal("email", "a@b.com");

			await vi.waitFor(() => {
				expect(interpreter.receivingAll).toEqual(["password"]);
			});
		});

		it("collects signal and workflow result concurrently via all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue({ name: "Max" }),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* all(receive("payment"), output("profile"));
			});

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receivingAll).toEqual(["payment"]);
			});

			interpreter.signal("payment", { card: "1234" });

			const result = await runPromise;
			expect(result).toEqual([{ card: "1234" }, { name: "Max" }]);
			expect(interpreter.status).toBe("completed");
			expect(mockRegistry.waitFor).toHaveBeenCalledWith("profile", {
				start: true,
				caller: undefined,
			});
		});

		it("records events for mixed signal + workflow all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("profile-data"),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* all(receive("payment"), output("profile"));
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("payment", "pay-data");
			await runPromise;

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "all_started",
					items: [{ type: "receive" }, { type: "output" }],
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
					type: "workflow_output_resolved",
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

		it("throws without registry when all() has output items", async () => {
			const wf = workflow(function* () {
				return yield* all(receive("payment"), output("profile"));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toContain("WorkflowRegistry");
		});

		it("replays mixed all() from event log", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* all(receive("payment"), output("profile"));
			});

			// seq 1 = receive "payment", seq 2 = output "profile", seq 3 = all command
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "all_started",
					seq: 3,
					items: [{ type: "receive" }, { type: "output" }],
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
			expect(mockRegistry.waitFor).not.toHaveBeenCalled();
		});

		it("handles signal arriving after workflow completes in all()", async () => {
			let resolveWorkflow: ((value: unknown) => void) | undefined;
			const workflowPromise = new Promise((resolve) => {
				resolveWorkflow = resolve;
			});

			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockReturnValue(workflowPromise),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* all(receive("payment"), output("profile"));
			});

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			// Workflow completes first
			resolveWorkflow?.({ name: "Max" });
			await new Promise((r) => setTimeout(r, 0));

			// Still waiting for signal
			expect(interpreter.status).toBe("waiting");

			// Now signal arrives
			interpreter.signal("payment", { card: "5678" });

			const result = await runPromise;
			expect(result).toEqual([{ card: "5678" }, { name: "Max" }]);
		});

		it("fails the workflow when a dependency workflow rejects in all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockRejectedValue(new Error("dependency failed")),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* all(receive("payment"), output("profile"));
			});

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toBe("dependency failed");
		});

		it("records workflow_dependency_failed when dependency fails in all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockRejectedValue(new Error("dep boom")),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* all(receive("payment"), output("profile"));
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
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
				waitFor: vi.fn().mockRejectedValue(new Error("dep boom")),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* all(receive("payment"), output("profile"));
			});

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
			expect(interpreter.receivingAll).toBeUndefined();
		});

		it("workflow can catch all() dependency failure and recover", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockRejectedValue(new Error("dep boom")),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				try {
					yield* all(receive("payment"), output("profile"));
					return "unreachable";
				} catch {
					return "recovered";
				}
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("recovered");
			expect(interpreter.status).toBe("completed");
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
			const childWorkflow = workflow(function* () {
				return yield* activity("childTask", async () => "child-result");
			});

			const parentWorkflow = workflow(function* () {
				const childResult = yield* child("sub", childWorkflow);
				return `parent got: ${childResult}`;
			});

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("parent got: child-result");
			expect(interpreter.status).toBe("completed");
		});

		it("child workflow has its own event log", async () => {
			const childWorkflow = workflow(function* () {
				return yield* activity("childTask", async () => "child-result");
			});

			const parentWorkflow = workflow(function* () {
				return yield* child("sub", childWorkflow);
			});

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

			const childWorkflow = workflow(function* () {
				childFn();
				return yield* activity("childTask", async () => "child-result");
			});

			const parentWorkflow = workflow(function* () {
				return yield* child("sub", childWorkflow);
			});

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
			const childWorkflow = workflow(function* () {
				return yield* activity("explode", async () => {
					throw new Error("child boom");
				});
			});

			const parentWorkflow = workflow(function* () {
				return yield* child("kid", childWorkflow);
			});

			const log = new EventLog();
			const interpreter = new Interpreter(parentWorkflow, log);
			await interpreter.run();

			expect(interpreter.status).toBe("failed");

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
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const calls1: string[] = [];
			const calls2: string[] = [];

			interpreter.onStateChange(() => calls1.push("a"));
			interpreter.onStateChange(() => calls2.push("b"));

			await interpreter.run();

			expect(calls1.length).toBeGreaterThan(0);
			expect(calls2.length).toBeGreaterThan(0);
		});

		it("returns an unsubscribe function", async () => {
			const wf = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const calls: string[] = [];

			const unsub = interpreter.onStateChange(() => calls.push("called"));

			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
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
			const wf = workflow(function* () {
				try {
					yield* activity("fail", async () => {
						throw new Error("boom");
					});
					return "unreachable";
				} catch {
					return "fallback";
				}
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("fallback");
			expect(interpreter.status).toBe("completed");
		});

		it("workflow catches error, does a second activity, returns its result", async () => {
			const wf = workflow(function* () {
				try {
					yield* activity("fail", async () => {
						throw new Error("boom");
					});
					return "unreachable";
				} catch {
					const result = yield* activity(
						"recover",
						async () => "recovered",
					);
					return result;
				}
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("recovered");
			expect(interpreter.status).toBe("completed");

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

			const wf = workflow(function* () {
				try {
					yield* activity("fail", failFn as () => Promise<string>);
					return "unreachable";
				} catch {
					const result = yield* activity(
						"recover",
						recoverFn as () => Promise<string>,
					);
					return result;
				}
			});

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

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe("recovered");
			expect(interpreter.status).toBe("completed");
			expect(failFn).not.toHaveBeenCalled();
			expect(recoverFn).not.toHaveBeenCalled();
		});
	});

	describe("compacted fast path", () => {
		it("returns result immediately from compacted workflow_completed event", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const wf = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const log = new EventLog([
				{ type: "workflow_completed", result: "hello", timestamp: 4 },
			]);

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe("hello");
			expect(interpreter.status).toBe("completed");
			expect(interpreter.result).toBe("hello");
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("sets failed state from compacted workflow_failed event", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const wf = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const log = new EventLog([
				{ type: "workflow_failed", error: "boom", timestamp: 4 },
			]);

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBeUndefined();
			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toBe("boom");
			expect(activityFn).not.toHaveBeenCalled();
		});
	});

	describe("events getter", () => {
		it("returns the event log entries", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const interpreter = new Interpreter(wf, new EventLog());
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
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const interpreter = new Interpreter(wf, new EventLog());
			expect(interpreter.published).toBeUndefined();
			await interpreter.run();
			expect(interpreter.published).toBeUndefined();
		});

		it("returns last published value after executePublish", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				yield* publish({ user: "max" });
				return "done";
			});

			const interpreter = new Interpreter(
				wf,
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

			const wf = workflow(function* () {
				yield* publish({ user: "max" });
				return "done";
			});

			const interpreter = new Interpreter(wf, log);
			await interpreter.run();

			expect(interpreter.published).toEqual({ user: "max" });
		});
	});

	describe("cancellation", () => {
		it("cancel() aborts in-flight activity and sets cancelled state", async () => {
			let activityStarted = false;
			const wf = workflow(function* () {
				return yield* activity(
					"slow",
					() =>
						new Promise((resolve) => {
							activityStarted = true;
							setTimeout(() => resolve("done"), 5000);
						}),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(activityStarted).toBe(true);
			});

			interpreter.cancel();

			await runPromise;

			expect(interpreter.status).toBe("cancelled");
		});

		it("cancel() breaks out of receive and sets cancelled state", async () => {
			const wf = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.cancel();

			await runPromise;

			expect(interpreter.status).toBe("cancelled");
		});

		it("cancel() breaks out of sleep and sets cancelled state", async () => {
			vi.useFakeTimers();

			const wf = workflow(function* () {
				yield* sleep(60000);
				return "done";
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			// Let the sleep start
			await vi.advanceTimersByTimeAsync(100);

			interpreter.cancel();

			await runPromise;

			expect(interpreter.status).toBe("cancelled");

			vi.useRealTimers();
		});

		it("cancel() is a no-op on completed workflows", async () => {
			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.status).toBe("completed");

			interpreter.cancel();

			expect(interpreter.status).toBe("completed");
			expect(interpreter.result).toBe("hello");
		});

		it("cancel() is a no-op on failed workflows", async () => {
			const wf = workflow(function* () {
				return yield* activity("fail", async () => {
					throw new Error("boom");
				});
			});

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.status).toBe("failed");

			interpreter.cancel();

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toBe("boom");
		});

		it("cancelled workflow logs workflow_cancelled event", async () => {
			const wf = workflow(function* () {
				const data = yield* receive<string>("submit");
				return `got: ${data}`;
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.cancel();

			await runPromise;

			expect(log.events()).toContainEqual(
				expect.objectContaining({ type: "workflow_cancelled" }),
			);
		});

		it("compacted fast path handles workflow_cancelled", async () => {
			const activityFn = vi.fn().mockResolvedValue("hello");
			const wf = workflow(function* () {
				return yield* activity("greet", activityFn);
			});

			const log = new EventLog([{ type: "workflow_cancelled", timestamp: 4 }]);

			const interpreter = new Interpreter(wf, log);
			await interpreter.run();

			expect(interpreter.status).toBe("cancelled");
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("activity receives AbortSignal that fires on cancel", async () => {
			let receivedSignal: AbortSignal | undefined;
			const wf = workflow(function* () {
				return yield* activity(
					"slow",
					(signal) =>
						new Promise((resolve) => {
							receivedSignal = signal;
							setTimeout(() => resolve("done"), 5000);
						}),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
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
			const wf = workflow(function* () {
				const result = yield* race(
					receive("add"),
					receive("remove"),
				);
				return result.winner === 0
					? `add:${result.value}`
					: `remove:${result.value}`;
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("add", "item-1");

			const result = await runPromise;
			expect(result).toBe("add:item-1");
			expect(interpreter.status).toBe("completed");
		});

		it("returns { winner, value } with correct discriminant", async () => {
			const wf = workflow(function* () {
				return yield* race(receive("a"), receive("b"));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("b", 42);

			const result = await runPromise;
			expect(result).toEqual({ winner: 1, value: 42 });
		});

		it("ignores signals not in the race", async () => {
			const wf = workflow(function* () {
				const { winner } = yield* race(receive("a"), receive("b"));
				return winner === 0 ? "a" : "b";
			});

			const interpreter = new Interpreter(wf, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("c", "ignored");

			// Should still be waiting
			expect(interpreter.status).toBe("waiting");
		});

		it("exposes waitingForAny getter", async () => {
			const wf = workflow(function* () {
					const { winner } = yield* race(
						receive("a"),
						receive("b"),
					);
					return winner === 0 ? "a" : "b";
				});

			const interpreter = new Interpreter(wf, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receivingAny).toEqual(["a", "b"]);
			});
		});

		it("replays from event log", async () => {
			const wf = workflow(function* () {
					const result = yield* race(receive("a"), receive("b"));
					return result.winner === 0
						? `a:${result.value}`
						: `b:${result.value}`;
				});

			// seq 1 = receive "a", seq 2 = receive "b", seq 3 = race command
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "race_started",
					seq: 3,
					items: [{ type: "receive" }, { type: "receive" }],
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

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe("b:replayed");
		});

		it("multiple sequential calls replay correctly", async () => {
			const wf = workflow(function* () {
					const first = yield* race(receive("a"), receive("b"));
					const second = yield* race(receive("a"), receive("b"));
					const firstName = first.winner === 0 ? "a" : "b";
					const secondName = second.winner === 0 ? "a" : "b";
					return `${firstName}-${secondName}`;
				});

			// First race: seq 1=receive "a", seq 2=receive "b", seq 3=race
			// Second race: seq 4=receive "a", seq 5=receive "b", seq 6=race
			const log = new EventLog([
				{ type: "workflow_started", timestamp: 1 },
				{
					type: "race_started",
					seq: 3,
					items: [{ type: "receive" }, { type: "receive" }],
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
					items: [{ type: "receive" }, { type: "receive" }],
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

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe("a-b");
		});

		it("records race_started and race_completed events", async () => {
			const wf = workflow(function* () {
					const { winner } = yield* race(
						receive("a"),
						receive("b"),
					);
					return winner === 0 ? "a" : "b";
				});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("a", "payload-a");
			await runPromise;

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "race_started",
					items: [{ type: "receive" }, { type: "receive" }],
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
			const wf = workflow(function* () {
					const { winner } = yield* race(
						receive("a"),
						receive("b"),
					);
					return winner === 0 ? "a" : "b";
				});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.cancel();
			await runPromise;

			expect(interpreter.status).toBe("cancelled");
		});
	});

	describe("Phase J: handler (N signals, loop)", () => {
		it("dispatches to matching handler", async () => {
			const wf = workflow(function* () {
				let message = "";
				const result = yield* handler()
					.on("greet", function* (payload: string, done) {
						message = payload;
						yield* done(message);
					})
					.as<string>();
				return result;
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("greet", "Max");

			const result = await runPromise;
			expect(result).toBe("Max");
		});

		it("loops: handles multiple signals before done", async () => {
			const wf = workflow(function* () {
				let count = 0;
				return yield* handler()
					.on("inc", function* () {
						count++;
					})
					.on("finish", function* (_payload: undefined, done) {
						yield* done(count);
					})
					.as<number>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("inc");
			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("inc");
			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("finish");

			const result = await runPromise;
			expect(result).toBe(2);
		});

		it("done() exits loop and returns value", async () => {
			const wf = workflow(function* () {
				return yield* handler()
					.on("stop", function* (payload: string, done) {
						yield* done(payload);
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("stop", "goodbye");

			const result = await runPromise;
			expect(result).toBe("goodbye");
		});

		it("handlers can yield commands (activity, sleep, etc.)", async () => {
			const wf = workflow(function* () {
				return yield* handler()
					.on("go", function* (_payload: undefined, done) {
						const result = yield* activity("fetch", async () => "fetched");
						yield* done(result);
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("go");

			const result = await runPromise;
			expect(result).toBe("fetched");
		});

		it("full loop replays from event log", async () => {
			const activityFn = vi.fn().mockResolvedValue("fetched");
			const makeWf = () =>
				workflow(function* () {
					let count = 0;
					return yield* handler()
						.on("inc", function* () {
							yield* activity("count", activityFn);
							count++;
						})
						.on("finish", function* (_payload: undefined, done) {
							yield* done(`total:${count}`);
						})
						.as<string>();
				});

			// Live run to capture event log
			const log = new EventLog();
			const interp1 = new Interpreter(makeWf(), log);
			const promise = interp1.run();

			await vi.waitFor(() => {
				expect(interp1.status).toBe("waiting");
			});
			interp1.signal("inc");

			await vi.waitFor(() => {
				expect(interp1.status).toBe("waiting");
			});
			interp1.signal("finish");
			await promise;

			expect(interp1.result).toBe("total:1");
			expect(activityFn).toHaveBeenCalledOnce();

			// Replay from same log — activity should not re-execute
			activityFn.mockClear();
			const interp2 = new Interpreter(makeWf(), log);
			const result = await interp2.run();

			expect(result).toBe("total:1");
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("handler error propagates as workflow failure", async () => {
			const wf = workflow(function* () {
				return yield* handler()
					.on("go", function* () {
						throw new Error("handler boom");
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("go");
			await runPromise;

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toBe("handler boom");
		});

		it("unmatched signal is skipped (re-waits)", async () => {
			const wf = workflow(function* () {
				return yield* handler()
					.on("a", function* (payload: string, done) {
						yield* done(payload);
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			// "b" has no handler — should be skipped
			interpreter.signal("b", "ignored");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("a", "matched");

			const result = await runPromise;
			expect(result).toBe("matched");
		});
	});

	describe("Phase J.2: handler (single signal, loop)", () => {
		it("loops on a single signal until done", async () => {
			const wf = workflow(function* () {
				const messages: string[] = [];
				return yield* handler()
					.on("input", function* (msg: string, done) {
						messages.push(msg);
						if (msg === "quit") {
							yield* done(messages);
						}
					})
					.as<string[]>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const promise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("input", "hello");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("input", "world");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("input", "quit");

			const result = await promise;
			expect(result).toEqual(["hello", "world", "quit"]);
		});

		it("handler can yield commands", async () => {
			const wf = workflow(function* () {
				return yield* handler()
					.on("go", function* (_payload: unknown, done) {
						const result = yield* activity("fetch", async () => "fetched");
						yield* done(result);
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const promise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("go");

			const result = await promise;
			expect(result).toBe("fetched");
		});

		it("handler error propagates as workflow failure", async () => {
			const wf = workflow(function* () {
				return yield* handler()
					.on("go", function* () {
						throw new Error("handler boom");
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const promise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("go");
			await promise;

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toBe("handler boom");
		});
	});

	describe("Phase J.3: handler (N signals, loop) — no .as()", () => {
		it("dispatches to matching handler", async () => {
			const wf = workflow(function* () {
				return yield* handler()
					.on("greet", function* (payload: string, done) {
						yield* done(payload);
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const promise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("greet", "Max");

			const result = await promise;
			expect(result).toBe("Max");
		});

		it("loops: handles multiple signals before done", async () => {
			const wf = workflow(function* () {
				let count = 0;
				return yield* handler()
					.on("inc", function* () {
						count++;
					})
					.on("finish", function* (_payload: undefined, done) {
						yield* done(count);
					})
					.as<number>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const promise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("inc");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("inc");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("finish");

			const result = await promise;
			expect(result).toBe(2);
		});

		it("handlers can yield commands", async () => {
			const wf = workflow(function* () {
				return yield* handler()
					.on("go", function* (_payload: undefined, done) {
						const result = yield* activity("fetch", async () => "fetched");
						yield* done(result);
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const promise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("go");

			const result = await promise;
			expect(result).toBe("fetched");
		});

		it("handler error propagates as workflow failure", async () => {
			const wf = workflow(function* () {
				return yield* handler()
					.on("go", function* () {
						throw new Error("handler boom");
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const promise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("go");
			await promise;

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toBe("handler boom");
		});
	});

	describe("Phase G.2: child signal routing", () => {
		it("delegates signal to child workflow", async () => {
			const childWorkflow = workflow(function* () {
					const val = yield* receive("data");
					return `child got: ${val}`;
				});

			const parentWorkflow = workflow(function* () {
					const result = yield* child("sub", childWorkflow);
					return `parent got: ${result}`;
				});

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("data", "hello");

			const result = await runPromise;
			expect(result).toBe("parent got: child got: hello");
			expect(interpreter.status).toBe("completed");
		});

		it("parent reports child's receiving", async () => {
			const childWorkflow = workflow(function* () {
					const val = yield* receive("info");
					return `got: ${val}`;
				});

			const parentWorkflow = workflow(function* () {
					return yield* child("sub", childWorkflow);
				});

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receiving).toBe("info");
			});
		});

		it("parent reports child's waitingForAll", async () => {
			const childWorkflow = workflow(function* () {
				return yield* all(receive("a"), receive("b"));
			});

			const parentWorkflow = workflow(function* () {
				return yield* child("sub", childWorkflow);
			});

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receivingAll).toEqual(["a", "b"]);
			});
		});

		it("parent reports child's waitingForAny", async () => {
			const childWorkflow = workflow(function* () {
					const { winner, value } = yield* race(
						receive("x"),
						receive("y"),
					);
					return winner === 0 ? `x:${value}` : `y:${value}`;
				});

			const parentWorkflow = workflow(function* () {
					return yield* child("sub", childWorkflow);
				});

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receivingAny).toEqual(["x", "y"]);
			});
		});

		it("delegates signal through nested grandchild", async () => {
			const grandchild = workflow(function* () {
				const val = yield* receive("deep");
				return `grandchild: ${val}`;
			});

			const childWf = workflow(function* () {
				return yield* child("grandchild", grandchild);
			});

			const parent = workflow(function* () {
				return yield* child("child", childWf);
			});

			const interpreter = new Interpreter(parent, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receiving).toBe("deep");
			});

			interpreter.signal("deep", "value");

			const result = await runPromise;
			expect(result).toBe("grandchild: value");
		});

		it("cancel propagates to active child", async () => {
			const childWorkflow = workflow(function* () {
					const val = yield* receive("data");
					return `got: ${val}`;
				});

			const parentWorkflow = workflow(function* () {
					return yield* child("sub", childWorkflow);
				});

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.cancel();
			await runPromise;

			expect(interpreter.status).toBe("cancelled");
		});

		it("signal is harmless when child is running an activity", async () => {
			let resolveActivity: ((value: string) => void) | undefined;
			const childWorkflow = workflow(function* () {
				return yield* activity(
					"slow",
					() =>
						new Promise<string>((resolve) => {
							resolveActivity = resolve;
						}),
				);
			});

			const parentWorkflow = workflow(function* () {
				return yield* child("sub", childWorkflow);
			});

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
			expect(interpreter.status).toBe("completed");
		});
	});

	describe("Phase K: race", () => {
		it("resolves with the activity when it beats the sleep", async () => {
			vi.useFakeTimers();

			const wf = workflow(function* () {
				return yield* race(
					activity("fast", async () => "data"),
					sleep(5000),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const result = await interpreter.run();

			expect(result).toEqual({ winner: 0, value: "data" });
			expect(interpreter.status).toBe("completed");

			vi.useRealTimers();
		});

		it("resolves with the sleep when the activity is slow", async () => {
			vi.useFakeTimers();

			const wf = workflow(function* () {
				return yield* race(
					activity(
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
					sleep(100),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.advanceTimersByTimeAsync(100);
			const result = await runPromise;

			expect(result).toEqual({ winner: 1, value: undefined });
			expect(interpreter.status).toBe("completed");

			vi.useRealTimers();
		});

		it("records race_started and race_completed events", async () => {
			const wf = workflow(function* () {
				return yield* race(
					activity("fetch", async () => "data"),
					sleep(5000),
				);
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
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
			const wf = workflow(function* () {
				return yield* race(
					activity("fetch", activityFn),
					sleep(5000),
				);
			});

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

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toEqual({ winner: 0, value: "data" });
			expect(activityFn).not.toHaveBeenCalled();
		});

		it("aborts the losing activity when sleep wins", async () => {
			vi.useFakeTimers();

			let receivedSignal: AbortSignal | undefined;
			const wf = workflow(function* () {
				return yield* race(
					activity(
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
					sleep(100),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.advanceTimersByTimeAsync(100);
			await runPromise;

			expect(receivedSignal).toBeDefined();
			expect(receivedSignal!.aborted).toBe(true);

			vi.useRealTimers();
		});

		it("races activity against receive signal", async () => {
			const wf = workflow(function* () {
				return yield* race(
					activity(
						"auto",
						() =>
							new Promise<string>((resolve) =>
								setTimeout(() => resolve("auto-result"), 5000),
							),
					),
					receive("manual"),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("manual", "manual-result");

			const result = await runPromise;
			expect(result).toEqual({ winner: 1, value: "manual-result" });
		});

		it("workflow can branch on winner index", async () => {
			const wf = workflow(function* () {
				const result = yield* race(
					activity("fetch", async () => "data"),
					sleep(5000),
				);
				if (result.winner === 0) {
					return `ok: ${result.value}`;
				}
				return "timeout";
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const result = await interpreter.run();

			expect(result).toBe("ok: data");
		});

		it("cancel() cleans up all race branches", async () => {
			vi.useFakeTimers();

			let activitySignal: AbortSignal | undefined;
			const wf = workflow(function* () {
				return yield* race(
					activity(
						"slow",
						(signal) =>
							new Promise<string>((resolve) => {
								activitySignal = signal;
								setTimeout(() => resolve("done"), 10000);
							}),
					),
					sleep(5000),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.advanceTimersByTimeAsync(100);

			interpreter.cancel();
			await runPromise;

			expect(interpreter.status).toBe("cancelled");
			expect(activitySignal?.aborted).toBe(true);

			vi.useRealTimers();
		});

		it("races two receive branches — first signal received wins", async () => {
			const wf = workflow(function* () {
				return yield* race(receive("approve"), receive("reject"));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("reject", "denied");

			const result = await runPromise;
			expect(result).toEqual({ winner: 1, value: "denied" });
			expect(interpreter.status).toBe("completed");
		});

		it("races three receive branches — third signal wins", async () => {
			const wf = workflow(function* () {
				return yield* race(
					receive("single"),
					receive("optA"),
					receive("optB"),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("optB", "picked-B");

			const result = await runPromise;
			expect(result).toEqual({
				winner: 2,
				value: "picked-B",
			});
		});

		it("races activity against child (child waits for signal)", async () => {
			const childWorkflow = workflow(function* () {
					const val = yield* receive("data");
					return `child got: ${val}`;
				});

			const wf = workflow(function* () {
				return yield* race(
					activity(
						"slow",
						() =>
							new Promise<string>((resolve) =>
								setTimeout(() => resolve("auto"), 10000),
							),
					),
					child("sub", childWorkflow),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
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

			const wf = workflow(function* () {
				return yield* race(
					all(
						activity("a", async () => "one"),
						activity("b", async () => "two"),
					),
					sleep(5000),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const result = await interpreter.run();

			expect(result).toEqual({ winner: 0, value: ["one", "two"] });

			vi.useRealTimers();
		});

		it("races output against sleep", async () => {
			vi.useFakeTimers();

			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("workflow-result"),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* race(output("dep"), sleep(5000));
			});

			const interpreter = new Interpreter(
				wf,
				new EventLog(),
				mockRegistry,
			);
			const result = await interpreter.run();

			expect(result).toEqual({ winner: 0, value: "workflow-result" });

			vi.useRealTimers();
		});

		it("cancel cleans up child in race", async () => {
			const childWorkflow = workflow(function* () {
					const val = yield* receive("data");
					return `got: ${val}`;
				});

			const wf = workflow(function* () {
				return yield* race(
					sleep(5000),
					child("sub", childWorkflow),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.cancel();
			await runPromise;

			expect(interpreter.status).toBe("cancelled");
		});

		it("exposes all signal names via waitingForAny during multi-signal race", async () => {
			const wf = workflow(function* () {
				return yield* race(receive("approve"), receive("reject"));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receivingAny).toEqual(
					expect.arrayContaining(["approve", "reject"]),
				);
			});
		});

		it("races receive against sleep — signal wins", async () => {
			vi.useFakeTimers();

			const wf = workflow(function* () {
				return yield* race(receive("approve"), sleep(5000));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("approve", "approved-by-manager");

			const result = await runPromise;
			expect(result).toEqual({ winner: 0, value: "approved-by-manager" });
			expect(interpreter.status).toBe("completed");

			vi.useRealTimers();
		});

		it("races receive against sleep — timeout wins", async () => {
			vi.useFakeTimers();

			const wf = workflow(function* () {
				return yield* race(receive("approve"), sleep(100));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.advanceTimersByTimeAsync(100);
			const result = await runPromise;

			expect(result).toEqual({ winner: 1, value: undefined });
			expect(interpreter.status).toBe("completed");

			vi.useRealTimers();
		});

		it("races receive against sleep — replays from event log", async () => {
			vi.useFakeTimers();

			const wf = workflow(function* () {
				return yield* race(receive("approve"), sleep(5000));
			});

			// First run: signal wins
			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("approve", "yes");
			const firstResult = await runPromise;
			expect(firstResult).toEqual({ winner: 0, value: "yes" });

			// Replay from recorded events
			const replayLog = new EventLog(log.events());
			const replayed = new Interpreter(wf, replayLog);
			const replayResult = await replayed.run();

			expect(replayResult).toEqual({ winner: 0, value: "yes" });
			expect(replayed.status).toBe("completed");

			vi.useRealTimers();
		});
	});

	describe("Profunctor: signal routing through combinators", () => {
		it("handler calling child with receive receives signal", async () => {
			const childWorkflow = workflow(function* () {
					const val = yield* receive("input");
					return `child: ${val}`;
				});

			const wf = workflow(function* () {
				return yield* handler()
					.on("go", function* (_payload: undefined, done) {
						const result = yield* child("sub", childWorkflow);
						yield* done(result);
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			// Send "go" to enter the handler
			interpreter.signal("go");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receiving).toBe("input");
			});

			// Send "input" which should route through to the child
			interpreter.signal("input", "hello");

			const result = await runPromise;
			expect(result).toBe("child: hello");
		});

		it("race with multiple receive routes signal to correct branch", async () => {
			const wf = workflow(function* () {
				const { winner, value } = yield* race(
					receive("approve"),
					receive("reject"),
				);
				return winner === 0 ? `approved: ${value}` : `rejected: ${value}`;
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("approve", "ok");

			const result = await runPromise;
			expect(result).toBe("approved: ok");
		});

		it("test runtime delivers signals into child workflows", async () => {
			const childWorkflow = workflow(function* () {
					const val = yield* receive("data");
					return `child: ${val}`;
				});

			const parentWorkflow = workflow(function* () {
					return yield* child("sub", childWorkflow);
				});

			const log = new EventLog();
			const interpreter = new Interpreter(parentWorkflow, log);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receiving).toBe("data");
			});

			interpreter.signal("data", "hello");

			const result = await runPromise;
			expect(result).toBe("child: hello");
		});

		it("nested child in handler routes signals through full chain", async () => {
			const grandchild = workflow(function* () {
					const val = yield* receive("value");
					return `deep: ${val}`;
				});

			const childWf = workflow(function* () {
				return yield* child("grandchild", grandchild);
			});

			const wf = workflow(function* () {
				return yield* handler()
					.on("start", function* (_payload: undefined, done) {
						const result = yield* child("child", childWf);
						yield* done(result);
					})
					.as<string>();
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("start");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receiving).toBe("value");
			});

			interpreter.signal("value", "deep-data");

			const result = await runPromise;
			expect(result).toBe("deep: deep-data");
		});

		it("child with race routes correct signal", async () => {
			const childWorkflow = workflow(function* () {
					const { winner, value } = yield* race(
						receive("a"),
						receive("b"),
					);
					return winner === 0 ? `a:${value}` : `b:${value}`;
				});

			const parentWorkflow = workflow(function* () {
					return yield* child("sub", childWorkflow);
				});

			const interpreter = new Interpreter(parentWorkflow, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receivingAny).toEqual(["a", "b"]);
			});

			interpreter.signal("b", "bee");

			const result = await runPromise;
			expect(result).toBe("b:bee");
		});
	});

	describe("Phase L: all", () => {
		it("collects multiple signals and returns tuple in order", async () => {
			const wf = workflow(function* () {
				return yield* all(receive("a"), receive("b"));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			// Send in reverse order
			interpreter.signal("b", "val-b");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("a", "val-a");

			const result = await runPromise;
			expect(result).toEqual(["val-a", "val-b"]);
			expect(interpreter.status).toBe("completed");
		});

		it("runs concurrent activities and returns all results", async () => {
			const wf = workflow(function* () {
				return yield* all(
					activity("a", async () => "one"),
					activity("b", async () => "two"),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
			expect(interpreter.status).toBe("completed");
		});

		it("mixes signal and activity in same all() call", async () => {
			const wf = workflow(function* () {
					return yield* all(
						receive("name"),
						activity("greet", async () => "hello"),
					);
				});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("name", "Max");

			const result = await runPromise;
			expect(result).toEqual(["Max", "hello"]);
		});

		it("records all_started and all_completed events", async () => {
			const wf = workflow(function* () {
				return yield* all(
					activity("a", async () => "one"),
					activity("b", async () => "two"),
				);
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
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

			const wf = workflow(function* () {
				return yield* all(activity("a", fnA), activity("b", fnB));
			});

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

			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toEqual(["one", "two"]);
			expect(fnA).not.toHaveBeenCalled();
			expect(fnB).not.toHaveBeenCalled();
		});

		it("cancel cleans up all branches", async () => {
			let activityStarted = false;
			const wf = workflow(function* () {
					return yield* all(
						receive("sig"),
						activity(
							"slow",
							() =>
								new Promise<string>((resolve) => {
									activityStarted = true;
									setTimeout(() => resolve("done"), 5000);
								}),
						),
					);
				});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.cancel();
			await runPromise;

			expect(interpreter.status).toBe("cancelled");
		});

		it("mixes signal and workflow output in all()", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue({ name: "Max" }),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* all(receive("payment"), output("profile"));
			});

			const interpreter = new Interpreter(
				wf,
				new EventLog(),
				mockRegistry,
			);
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("payment", { card: "1234" });

			const result = await runPromise;
			expect(result).toEqual([{ card: "1234" }, { name: "Max" }]);
			expect(interpreter.status).toBe("completed");
		});

		it("signals reach the correct receive branch", async () => {
			const wf = workflow(function* () {
				return yield* all(
					receive("a"),
					receive("b"),
					receive("c"),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			const runPromise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			// Send out of order
			interpreter.signal("c", "C");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("a", "A");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});

			interpreter.signal("b", "B");

			const result = await runPromise;
			expect(result).toEqual(["A", "B", "C"]);
		});

		it("exposes waitingForAll with remaining signal names", async () => {
			const wf = workflow(function* () {
				return yield* all(receive("x"), receive("y"));
			});

			const interpreter = new Interpreter(wf, new EventLog());
			interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
				expect(interpreter.receivingAll).toEqual(["x", "y"]);
			});

			interpreter.signal("x", "val-x");

			await vi.waitFor(() => {
				expect(interpreter.receivingAll).toEqual(["y"]);
			});
		});

		it("fails the whole all() when one activity fails", async () => {
			const wf = workflow(function* () {
				return yield* all(
					activity("ok", async () => "fine"),
					activity("bad", async () => {
						throw new Error("oops");
					}),
				);
			});

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toBe("oops");
		});
	});

	describe("Event observers", () => {
		it("observer on EventLog receives all events from a workflow run", async () => {
			const observed: import("./types").WorkflowEvent[] = [];
			const log = new EventLog([], (event) => observed.push(event));

			const wf = workflow(function* () {
				return yield* activity("greet", async () => "hello");
			});

			const interpreter = new Interpreter(wf, log);
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

			const childWorkflow = workflow(function* () {
				return yield* activity("childTask", async () => "child-result");
			});

			const parentWorkflow = workflow(function* () {
				return yield* child("sub", childWorkflow);
			});

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
				waitFor: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				yield* publish("account-123");
				return "done";
			});

			const log = new EventLog();
			const interpreter = new Interpreter(
				wf,
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
				waitFor: vi.fn(),
				start: vi.fn(),
				publish: publishFn,
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				yield* publish("account-123");
				return "done";
			});

			const interpreter = new Interpreter(
				wf,
				new EventLog(),
				mockRegistry,
				"session",
			);
			await interpreter.run();

			expect(publishFn).toHaveBeenCalledWith("session", "account-123");
		});

		it("workflow continues executing after publish", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				yield* publish("account-123");
				const result = yield* activity("doMore", async () => "extra");
				return result;
			});

			const interpreter = new Interpreter(
				wf,
				new EventLog(),
				mockRegistry,
				"session",
			);
			const result = await interpreter.run();

			expect(result).toBe("extra");
			expect(interpreter.status).toBe("completed");
		});

		it("replays publish from event log without calling registry", async () => {
			const publishFn = vi.fn();
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn(),
				start: vi.fn(),
				publish: publishFn,
			getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				yield* publish("account-123");
				return "done";
			});

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
				wf,
				log,
				mockRegistry,
				"session",
			);
			await interpreter.run();

			expect(publishFn).not.toHaveBeenCalled();
		});

		it("works without registry (sets published value locally)", async () => {
			const wf = workflow(function* () {
				yield* publish("account-123");
				return "done";
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			await interpreter.run();

			expect(interpreter.status).toBe("completed");
			expect(interpreter.published).toBe("account-123");
		});
	});

	describe("Phase M: loop / loopBreak", () => {
		it("loops until loopBreak is yielded", async () => {
			let iterations = 0;
			const wf = workflow(function* () {
				return yield* loop(function* () {
					iterations++;
					const msg = yield* receive("input").as<string>();
					if (msg === "quit") {
						yield* loopBreak("done");
					}
				});
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const promise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.receiving).toBe("input");
			});
			interpreter.signal("input", "hello");

			await vi.waitFor(() => {
				expect(interpreter.receiving).toBe("input");
			});
			interpreter.signal("input", "world");

			await vi.waitFor(() => {
				expect(interpreter.receiving).toBe("input");
			});
			interpreter.signal("input", "quit");

			const result = await promise;

			expect(result).toBe("done");
			expect(iterations).toBe(3);
		});

		it("loopBreak value becomes the return value of loop", async () => {
			const wf = workflow(function* () {
				return yield* loop(function* () {
					yield* loopBreak(42);
				});
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe(42);
		});

		it("loop body can yield activities", async () => {
			const calls: string[] = [];
			const wf = workflow(function* () {
				let count = 0;
				return yield* loop(function* () {
					count++;
					yield* activity(`work-${count}`, async () => {
						calls.push(`work-${count}`);
						return count;
					});
					if (count >= 3) {
						yield* loopBreak(count);
					}
				});
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const result = await interpreter.run();

			expect(result).toBe(3);
			expect(calls).toEqual(["work-1", "work-2", "work-3"]);
		});

		it("loop body can publish values", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn(),
				start: vi.fn(),
				publish: vi.fn(),
				getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				let count = 0;
				return yield* loop(function* () {
					count++;
					yield* publish(count);
					if (count >= 2) {
						yield* loopBreak("done");
					}
				});
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry, "counter");
			const result = await interpreter.run();

			expect(result).toBe("done");
			expect(mockRegistry.publish).toHaveBeenCalledWith("counter", 1);
			expect(mockRegistry.publish).toHaveBeenCalledWith("counter", 2);
		});

		it("loop emits loop_started and loop_completed events", async () => {
			const wf = workflow(function* () {
				return yield* loop(function* () {
					yield* loopBreak("result");
				});
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			await interpreter.run();

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({ type: "loop_started" }),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "loop_completed",
					value: "result",
				}),
			);
		});

		it("replays loop from event log", async () => {
			const wf = workflow(function* () {
				return yield* loop(function* () {
					const msg = yield* receive("input").as<string>();
					if (msg === "quit") {
						yield* loopBreak("done");
					}
				});
			});

			// First run
			const log = new EventLog();
			const interp1 = new Interpreter(wf, log);
			const promise = interp1.run();

			await vi.waitFor(() => {
				expect(interp1.receiving).toBe("input");
			});
			interp1.signal("input", "hello");

			await vi.waitFor(() => {
				expect(interp1.receiving).toBe("input");
			});
			interp1.signal("input", "quit");
			await promise;

			// Replay from same log
			const interp2 = new Interpreter(wf, log);
			const result = await interp2.run();
			expect(result).toBe("done");
		});

		it("loop works inside race", async () => {
			const wf = workflow(function* () {
				return yield* race(
					loop(function* () {
						const msg = yield* receive("chat").as<string>();
						if (msg === "quit") {
							yield* loopBreak("chat-done");
						}
					}),
					receive("cancel").as<string>(),
				);
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log);
			const promise = interpreter.run();

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("chat", "hello");

			await vi.waitFor(() => {
				expect(interpreter.status).toBe("waiting");
			});
			interpreter.signal("chat", "quit");

			const result = await promise;

			expect(result).toEqual({ winner: 0, value: "chat-done" });
		});
	});

	describe("output()", () => {
		it("delegates to registry.waitFor and returns the result", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("config-data"),
				start: vi.fn(),
				publish: vi.fn(),
				getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				const config = yield* output("config");
				return `got: ${config}`;
			});

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("got: config-data");
			expect(mockRegistry.waitFor).toHaveBeenCalledWith("config", {
				start: true,
				caller: undefined,
			});
		});

		it("passes start: false option to registry", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("result"),
				start: vi.fn(),
				publish: vi.fn(),
				getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* output("config", { start: false });
			});

			const interpreter = new Interpreter(wf, new EventLog(), mockRegistry);
			await interpreter.run();

			expect(mockRegistry.waitFor).toHaveBeenCalledWith("config", {
				start: false,
				caller: undefined,
			});
		});

		it("throws without a registry", async () => {
			const wf = workflow(function* () {
				return yield* output("config");
			});

			const interpreter = new Interpreter(wf, new EventLog());
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
			expect(interpreter.error).toContain("WorkflowRegistry");
		});

		it("records dependency_started and output_resolved events", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("config-data"),
				start: vi.fn(),
				publish: vi.fn(),
				getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* output("config");
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			await interpreter.run();

			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_started",
					workflowId: "config",
				}),
			);
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_output_resolved",
					workflowId: "config",
					result: "config-data",
				}),
			);
		});

		it("replays from event log without calling registry", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockResolvedValue("config-data"),
				start: vi.fn(),
				publish: vi.fn(),
				getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* output("config");
			});

			// First run
			const log = new EventLog();
			const interp1 = new Interpreter(wf, log, mockRegistry);
			await interp1.run();

			// Second run — replays from log
			const interp2 = new Interpreter(wf, log, mockRegistry);
			const result = await interp2.run();

			expect(result).toBe("config-data");
			// waitFor called once for first run, not again for replay
			expect(mockRegistry.waitFor).toHaveBeenCalledTimes(1);
		});

		it("records dependency_failed event on error", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockRejectedValue(new Error("not found")),
				start: vi.fn(),
				publish: vi.fn(),
				getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				return yield* output("config");
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			await interpreter.run();

			expect(interpreter.status).toBe("failed");
			const events = log.events();
			expect(events).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_failed",
					workflowId: "config",
					error: "not found",
				}),
			);
		});

		it("workflow can catch dependency failure and recover", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockRejectedValue(new Error("dependency failed")),
				start: vi.fn(),
				publish: vi.fn(),
				getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				try {
					yield* output("config");
					return "unreachable";
				} catch {
					return "recovered";
				}
			});

			const log = new EventLog();
			const interpreter = new Interpreter(wf, log, mockRegistry);
			const result = await interpreter.run();

			expect(result).toBe("recovered");
			expect(interpreter.status).toBe("completed");
			expect(log.events()).toContainEqual(
				expect.objectContaining({
					type: "workflow_dependency_failed",
					workflowId: "config",
					seq: 1,
					error: "dependency failed",
				}),
			);
		});

		it("replays failure from event log", async () => {
			const mockRegistry: WorkflowRegistryInterface = {
				waitFor: vi.fn().mockRejectedValue(new Error("not found")),
				start: vi.fn(),
				publish: vi.fn(),
				getPublishSeq: vi.fn().mockReturnValue(0),
			};

			const wf = workflow(function* () {
				try {
					yield* output("config");
					return "success";
				} catch {
					return "caught";
				}
			});

			// First run — error is recorded
			const log = new EventLog();
			const interp1 = new Interpreter(wf, log, mockRegistry);
			await interp1.run();
			expect(interp1.result).toBe("caught");

			// Replay — error replays from log
			const interp2 = new Interpreter(wf, log, mockRegistry);
			const result = await interp2.run();
			expect(result).toBe("caught");
			expect(mockRegistry.waitFor).toHaveBeenCalledTimes(1);
		});
	});
});

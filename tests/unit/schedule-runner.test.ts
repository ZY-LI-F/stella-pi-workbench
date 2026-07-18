// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AutopilotService } from "../../src/main/autopilot-service";
import type { BoardRepository } from "../../src/main/board-repository";
import { ScheduleRunner, type ScheduleTimer, type ScheduleTimerHandle } from "../../src/main/schedule-runner";
import {
  EMPTY_BOARD_STATE,
  parseBoardState,
  type BoardBootstrap,
  type BoardBridgeEvent,
  type BoardState,
  type CreateAutopilotInput,
} from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

interface TimerRecord {
  readonly handle: ScheduleTimerHandle;
  readonly callback: () => void;
  readonly delayMs: number;
  readonly cleared: boolean;
}

class FakeTimer implements ScheduleTimer {
  readonly records: TimerRecord[] = [];
  #value = 0;

  set(callback: () => void, delayMs: number): ScheduleTimerHandle {
    const handle = Object.freeze({ id: ++this.#value }) as unknown as ScheduleTimerHandle;
    this.records.push(Object.freeze({ handle, callback, delayMs, cleared: false }));
    return handle;
  }

  clear(handle: ScheduleTimerHandle): void {
    const index = this.records.findIndex((record) => record.handle === handle);
    const record = this.records[index];
    if (!record) return;
    this.records[index] = Object.freeze({ ...record, cleared: true });
  }

  latest(): TimerRecord {
    const record = this.records.at(-1);
    if (!record) throw new Error("测试计时器没有待执行记录");
    return record;
  }
}

function idFactory(): () => string {
  let value = 0;
  return () => `schedule-id-${String(++value).padStart(3, "0")}`;
}

function scheduleInput(nextRunAt: string, enabled = true): CreateAutopilotInput {
  return Object.freeze({
    name: "周期代码复核",
    enabled,
    trigger: Object.freeze({ kind: "schedule", intervalMinutes: 60, nextRunAt }),
    taskTemplate: Object.freeze({
      title: "运行周期复核",
      description: "检查工作区",
      acceptanceCriteria: "留下验证报告",
      priority: "medium",
    }),
    projectPath: "C:/project",
    projectName: "project",
    trusted: true,
    executionTarget: Object.freeze({ kind: "agent", agentId: "tester" }),
  });
}

function setup(initialNow: string, dispatch?: (taskId: string) => Promise<BoardBootstrap>) {
  const repository = new MemoryRepository();
  const timer = new FakeTimer();
  const events: BoardBridgeEvent[] = [];
  let now = initialNow;
  const service = new AutopilotService({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    dispatchTask: dispatch ?? (async () => Object.freeze({ board: repository.state, catalog: BUILTIN_ORCHESTRATION_CATALOG })),
    emitChanged: () => undefined,
    now: () => now,
    id: idFactory(),
  });
  const runner = new ScheduleRunner({
    repository,
    autopilotService: service,
    emitBoardEvent: (event) => events.push(event),
    now: () => now,
    timer,
  });
  return { repository, service, runner, timer, events, setNow: (value: string) => { now = value; } };
}

describe("ScheduleRunner", () => {
  it("records one missed startup audit and advances to the first future occurrence", async () => {
    const context = setup("2026-07-18T10:30:00.000Z");
    await context.service.create(scheduleInput("2026-07-18T08:00:00.000Z"));

    await context.runner.start();

    expect(context.repository.state.tasks).toHaveLength(0);
    expect(context.repository.state.autopilotRuns).toHaveLength(1);
    expect(context.repository.state.autopilotRuns[0]).toMatchObject({
      triggerKind: "schedule",
      status: "missed",
      startedAt: "2026-07-18T08:00:00.000Z",
      completedAt: "2026-07-18T10:30:00.000Z",
    });
    expect(context.repository.state.autopilots[0]?.trigger).toEqual({
      kind: "schedule",
      intervalMinutes: 60,
      nextRunAt: "2026-07-18T11:00:00.000Z",
    });
    expect(context.timer.latest().delayMs).toBe(30 * 60_000);
  });

  it("runs one due occurrence while open, creates a fresh task, and advances before the next timer", async () => {
    const dispatched: string[] = [];
    let repository: MemoryRepository;
    const context = setup("2026-07-18T10:00:00.000Z", async (taskId) => {
      dispatched.push(taskId);
      return Object.freeze({ board: repository.state, catalog: BUILTIN_ORCHESTRATION_CATALOG });
    });
    repository = context.repository;
    await context.service.create(scheduleInput("2026-07-18T10:05:00.000Z"));
    await context.runner.start();
    const dueTimer = context.timer.latest();
    expect(dueTimer.delayMs).toBe(5 * 60_000);

    context.setNow("2026-07-18T10:05:00.000Z");
    dueTimer.callback();
    await vi.waitFor(() => expect(context.repository.state.autopilotRuns[0]?.status).toBe("succeeded"));

    expect(context.repository.state.tasks).toHaveLength(1);
    expect(dispatched).toEqual([context.repository.state.tasks[0]?.id]);
    expect(context.repository.state.autopilots[0]?.trigger).toMatchObject({ nextRunAt: "2026-07-18T11:05:00.000Z" });
    await vi.waitFor(() => expect(context.timer.latest().delayMs).toBe(60 * 60_000));
  });

  it("invalidates a captured old timer after a rule is disabled", async () => {
    const dispatchTask = vi.fn(async () => Object.freeze({ board: EMPTY_BOARD_STATE, catalog: BUILTIN_ORCHESTRATION_CATALOG }));
    const context = setup("2026-07-18T10:00:00.000Z", dispatchTask);
    await context.service.create(scheduleInput("2026-07-18T10:01:00.000Z"));
    await context.runner.start();
    const staleTimer = context.timer.latest();
    const autopilot = context.repository.state.autopilots[0];
    if (!autopilot || autopilot.trigger.kind !== "schedule") throw new Error("测试 Schedule 未创建");

    await context.service.update({
      ...scheduleInput(autopilot.trigger.nextRunAt, false),
      autopilotId: autopilot.id,
      trigger: autopilot.trigger,
    });
    await context.runner.notify();
    expect(staleTimer.cleared).toBe(false);
    expect(context.timer.records.find((record) => record.handle === staleTimer.handle)?.cleared).toBe(true);

    context.setNow("2026-07-18T10:01:00.000Z");
    staleTimer.callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dispatchTask).not.toHaveBeenCalled();
    expect(context.repository.state.tasks).toHaveLength(0);
  });

  it("persists a failed due run, advances its cadence, and emits the exact scheduler error", async () => {
    const context = setup("2026-07-18T10:00:00.000Z", async () => {
      throw new Error("真实 Pi Runtime 无法启动");
    });
    await context.service.create(scheduleInput("2026-07-18T10:01:00.000Z"));
    await context.runner.start();
    context.setNow("2026-07-18T10:01:00.000Z");
    context.timer.latest().callback();

    await vi.waitFor(() => expect(context.repository.state.autopilotRuns[0]?.status).toBe("failed"));
    expect(context.repository.state.autopilotRuns[0]?.error).toBe("真实 Pi Runtime 无法启动");
    expect(context.repository.state.autopilots[0]?.trigger).toMatchObject({ nextRunAt: "2026-07-18T11:01:00.000Z" });
    expect(context.events).toContainEqual(expect.objectContaining({
      type: "automation-error",
      source: "schedule",
      message: expect.stringContaining("真实 Pi Runtime 无法启动"),
    }));
  });
});

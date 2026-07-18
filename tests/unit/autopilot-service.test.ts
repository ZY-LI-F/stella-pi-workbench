// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { AutopilotService } from "../../src/main/autopilot-service";
import type { BoardRepository } from "../../src/main/board-repository";
import {
  EMPTY_BOARD_STATE,
  parseBoardState,
  type BoardBootstrap,
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

function idFactory(): () => string {
  let value = 0;
  return () => `auto-id-${String(++value).padStart(3, "0")}`;
}

const MANUAL_INPUT: CreateAutopilotInput = Object.freeze({
  name: "发布前复核",
  enabled: true,
  trigger: Object.freeze({ kind: "manual" }),
  taskTemplate: Object.freeze({
    title: "检查发布候选版本",
    description: "检查当前工作区变更",
    acceptanceCriteria: "测试通过并给出报告",
    priority: "high",
  }),
  projectPath: "C:/project",
  projectName: "project",
  trusted: true,
  executionTarget: Object.freeze({ kind: "agent", agentId: "tester" }),
});

function setup(dispatchTask?: (taskId: string) => Promise<BoardBootstrap>) {
  const repository = new MemoryRepository();
  const changed: BoardBootstrap[] = [];
  const service = new AutopilotService({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    dispatchTask: dispatchTask ?? (async () => Object.freeze({ board: repository.state, catalog: BUILTIN_ORCHESTRATION_CATALOG })),
    emitChanged: (bootstrap) => changed.push(bootstrap),
    id: idFactory(),
    token: () => "webhook-token",
    now: () => "2026-07-18T08:00:00.000Z",
  });
  return { repository, service, changed };
}

describe("AutopilotService", () => {
  it("creates, updates, and deletes a strictly validated Manual rule", async () => {
    const { repository, service } = setup();
    await service.create(MANUAL_INPUT);
    const created = repository.state.autopilots[0];
    expect(created).toMatchObject({ name: "发布前复核", trigger: { kind: "manual" }, projectPath: "C:/project" });

    if (!created) throw new Error("测试 Autopilot 未创建");
    await service.update({ ...MANUAL_INPUT, autopilotId: created.id, name: "发布复核 v2", trigger: { kind: "manual" } });
    expect(repository.state.autopilots[0]?.name).toBe("发布复核 v2");

    await service.delete(created.id);
    expect(repository.state.autopilots).toHaveLength(0);
    await expect(service.create({ ...MANUAL_INPUT, name: "", taskTemplate: { ...MANUAL_INPUT.taskTemplate, title: "" } })).rejects.toThrow("Autopilot 名称不能为空");
  });

  it("creates a fresh Task and successful audit on every Manual trigger", async () => {
    const dispatched: string[] = [];
    let repository: MemoryRepository;
    const setupResult = setup(async (taskId) => {
      dispatched.push(taskId);
      return Object.freeze({ board: repository.state, catalog: BUILTIN_ORCHESTRATION_CATALOG });
    });
    repository = setupResult.repository;
    await setupResult.service.create(MANUAL_INPUT);
    const autopilotId = repository.state.autopilots[0]?.id;
    if (!autopilotId) throw new Error("测试 Autopilot 未创建");

    await setupResult.service.trigger({ autopilotId, triggerKind: "manual" });
    await setupResult.service.trigger({ autopilotId, triggerKind: "manual" });

    expect(repository.state.tasks).toHaveLength(2);
    expect(new Set(repository.state.tasks.map((task) => task.id)).size).toBe(2);
    expect(dispatched).toEqual(repository.state.tasks.map((task) => task.id).reverse());
    expect(repository.state.autopilotRuns).toHaveLength(2);
    expect(repository.state.autopilotRuns.every((run) => run.status === "succeeded" && Boolean(run.taskId))).toBe(true);
    expect(repository.state.activities.filter((activity) => activity.kind === "automation")).toHaveLength(2);
  });

  it("rejects disabled rules before creating a Task or audit", async () => {
    const dispatchTask = vi.fn(async () => {
      throw new Error("不应分发");
    });
    const { repository, service } = setup(dispatchTask);
    await service.create({ ...MANUAL_INPUT, enabled: false });
    const autopilotId = repository.state.autopilots[0]?.id;
    if (!autopilotId) throw new Error("测试 Autopilot 未创建");

    await expect(service.trigger({ autopilotId, triggerKind: "manual" })).rejects.toThrow("已禁用");
    expect(repository.state.tasks).toHaveLength(0);
    expect(repository.state.autopilotRuns).toHaveLength(0);
    expect(dispatchTask).not.toHaveBeenCalled();
  });

  it("persists the exact dispatch failure in the audit and still rejects the trigger", async () => {
    const { repository, service } = setup(async () => {
      throw new Error("Pi Agent 启动失败：ENOENT");
    });
    await service.create(MANUAL_INPUT);
    const autopilotId = repository.state.autopilots[0]?.id;
    if (!autopilotId) throw new Error("测试 Autopilot 未创建");

    await expect(service.trigger({ autopilotId, triggerKind: "manual" })).rejects.toThrow("Autopilot 触发失败: Pi Agent 启动失败：ENOENT");
    expect(repository.state.tasks).toHaveLength(1);
    expect(repository.state.autopilotRuns[0]).toMatchObject({
      status: "failed",
      error: "Pi Agent 启动失败：ENOENT",
      taskId: repository.state.tasks[0]?.id,
    });
    expect(repository.state.activities.at(-1)).toMatchObject({ kind: "error", detail: "Pi Agent 启动失败：ENOENT" });
  });
});

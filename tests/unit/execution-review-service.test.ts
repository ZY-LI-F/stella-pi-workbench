// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ExecutionReviewService } from "../../src/main/execution-review-service";
import type { BoardRepository } from "../../src/main/board-repository";
import {
  BOARD_SCHEMA_VERSION,
  parseBoardState,
  type BoardState,
  type KanbanTask,
} from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const CREATED_AT = "2026-07-18T00:00:00.000Z";
const REVIEWED_AT = "2026-07-18T01:00:00.000Z";
const workflow = BUILTIN_ORCHESTRATION_CATALOG.workflows.find((candidate) => candidate.id === "read-only-review");
const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((candidate) => candidate.id === "builder");
if (!workflow || !builder) throw new Error("测试目录缺少执行定义");
const workflowAgentIds = new Set(workflow.steps.filter((step) => step.kind === "agent").map((step) => step.agentId));

const TASK: KanbanTask = Object.freeze({
  id: "task-review",
  title: "验收执行结果",
  description: "",
  acceptanceCriteria: "人工明确确认",
  priority: "high",
  projectPath: "C:/project",
  projectName: "project",
  trusted: true,
  executionTarget: Object.freeze({ kind: "workflow", workflowId: workflow.id }),
  stage: "blocked",
  blockedReason: "业务阶段由用户维护",
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
});

function initialState(): BoardState {
  return parseBoardState({
    version: BOARD_SCHEMA_VERSION,
    tasks: [TASK],
    runs: [{
      id: "run-reported",
      taskId: TASK.id,
      workflow,
      agents: BUILTIN_ORCHESTRATION_CATALOG.agents.filter((agent) => workflowAgentIds.has(agent.id)),
      status: "reported",
      acceptance: "pending",
      steps: workflow.steps.map((step, index) => ({
        id: `step-${index}`,
        stepId: step.id,
        stepKind: step.kind,
        name: step.name,
        status: "succeeded",
        agentId: step.kind === "agent" ? step.agentId : undefined,
        startedAt: CREATED_AT,
        completedAt: CREATED_AT,
      })),
      startedAt: CREATED_AT,
      updatedAt: CREATED_AT,
      completedAt: CREATED_AT,
    }],
    activities: [],
    comments: [],
    agentTasks: [{
      id: "agent-reported",
      taskId: TASK.id,
      agentSnapshot: builder,
      kind: "direct",
      status: "reported",
      acceptance: "pending",
      prompt: "交付",
      output: "全部测试通过——这仍然只是 Agent 报告",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      startedAt: CREATED_AT,
      completedAt: CREATED_AT,
    }],
    customAgents: [],
    squads: [],
    autopilots: [],
    autopilotRuns: [],
  });
}

class MemoryRepository implements BoardRepository {
  constructor(public state: BoardState = initialState()) {}
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

function setup() {
  const repository = new MemoryRepository();
  let id = 0;
  const service = new ExecutionReviewService({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    emitChanged: () => undefined,
    now: () => REVIEWED_AT,
    id: () => `review-${++id}`,
  });
  return { repository, service };
}

describe("ExecutionReviewService", () => {
  it("accepts a reported Workflow and deterministically completes the Task", async () => {
    const { repository, service } = setup();
    expect(repository.state.runs[0]?.acceptance).toBe("pending");

    await service.review({ taskId: TASK.id, executionKind: "workflow", executionId: "run-reported", decision: "accept", comment: "" });

    expect(repository.state.runs[0]).toMatchObject({ acceptance: "accepted", reviewedAt: REVIEWED_AT });
    expect(repository.state.tasks[0]).toMatchObject({ stage: "completed" });
    expect(repository.state.tasks[0]?.blockedReason).toBeUndefined();
    expect(repository.state.comments[0]).toMatchObject({ author: "user", messageKind: "acceptance", runId: "run-reported", body: "已接受" });
    expect(repository.state.activities[0]).toMatchObject({ kind: "gate", runId: "run-reported", summary: "执行结果已接受" });
  });

  it("records a revision reason once and never rewrites that decision", async () => {
    const { repository, service } = setup();
    await service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "revision-requested", comment: "补充 Windows 安装验证" });

    expect(repository.state.agentTasks[0]).toMatchObject({
      status: "reported",
      acceptance: "revision-requested",
      acceptanceComment: "补充 Windows 安装验证",
      reviewedAt: REVIEWED_AT,
    });
    expect(repository.state.tasks[0]).toMatchObject({ stage: "planned" });
    const decided = repository.state;
    await expect(service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "accept", comment: "改成接受" }))
      .rejects.toThrow("验收结论已记录");
    expect(repository.state).toBe(decided);
  });

  it("blocks review while the task has a newer active execution", async () => {
    const base = initialState();
    const repository = new MemoryRepository(parseBoardState({
      ...base,
      tasks: base.tasks.map((task) => ({ ...task, activeAgentTaskId: "agent-active" })),
      agentTasks: [
        ...base.agentTasks,
        {
          id: "agent-active", taskId: TASK.id, agentSnapshot: builder, kind: "direct", status: "queued",
          acceptance: "not-ready", prompt: "新一轮执行", createdAt: REVIEWED_AT, updatedAt: REVIEWED_AT,
        },
      ],
    }));
    let id = 0;
    const service = new ExecutionReviewService({
      repository,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: () => undefined,
      now: () => REVIEWED_AT,
      id: () => `review-${++id}`,
    });
    const before = repository.state;
    await expect(service.review({ taskId: TASK.id, executionKind: "workflow", executionId: "run-reported", decision: "accept", comment: "" }))
      .rejects.toThrow("正在进行的执行");
    await expect(service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "revision-requested", comment: "先中止执行" }))
      .rejects.toThrow("正在进行的执行");
    await expect(service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "reject", comment: "先中止执行" }))
      .rejects.toThrow("正在进行的执行");
    expect(repository.state).toBe(before);
  });

  it("requires reasons for revision/rejection and rejects failed false-success review", async () => {
    const { repository, service } = setup();
    await expect(service.review({ taskId: TASK.id, executionKind: "workflow", executionId: "run-reported", decision: "reject", comment: "  " }))
      .rejects.toThrow("必须填写理由");
    repository.state = parseBoardState({
      ...repository.state,
      agentTasks: repository.state.agentTasks.map((agentTask) => ({
        ...agentTask,
        status: "failed",
        acceptance: "not-ready",
        output: undefined,
        error: "Runtime failed after a fluent final sentence",
      })),
    });
    await expect(service.review({ taskId: TASK.id, executionKind: "agent-task", executionId: "agent-reported", decision: "accept", comment: "" }))
      .rejects.toThrow("尚未 reported");
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
  });
});

import { describe, expect, it } from "vitest";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import type { AgentTask, KanbanTask, TaskActivity, TaskComment, WorkflowRun } from "../../src/shared/kanban";
import { projectTaskTimeline } from "../../src/shared/task-timeline";

const BUILDER = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
const WORKFLOW = BUILTIN_ORCHESTRATION_CATALOG.workflows[0];
if (!BUILDER || !WORKFLOW) throw new Error("测试目录不完整");

const TASK: KanbanTask = Object.freeze({
  id: "task-1",
  title: "构建 Task Room",
  description: "统一展示任务事实",
  acceptanceCriteria: "来源可追溯",
  priority: "high",
  projectPath: "C:/project",
  projectName: "project",
  trusted: true,
  executionTarget: Object.freeze({ kind: "agent", agentId: "builder" }),
  stage: "planned",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
});

const RUN: WorkflowRun = Object.freeze({
  id: "run-1",
  taskId: TASK.id,
  workflow: WORKFLOW,
  agents: Object.freeze([BUILDER]),
  status: "reported",
  acceptance: "pending",
  steps: Object.freeze([Object.freeze({
    id: "step-run-1",
    stepId: WORKFLOW.steps[0]?.id ?? "step-1",
    stepKind: "agent",
    name: "实现",
    status: "succeeded",
    agentId: BUILDER.id,
    artifact: Object.freeze({ title: "实现报告", content: "完成" }),
    startedAt: "2026-07-18T00:01:00.000Z",
    completedAt: "2026-07-18T00:02:00.000Z",
  })]),
  startedAt: "2026-07-18T00:01:00.000Z",
  updatedAt: "2026-07-18T00:02:00.000Z",
  completedAt: "2026-07-18T00:02:00.000Z",
});

const AGENT_TASK: AgentTask = Object.freeze({
  id: "agent-task-1",
  taskId: TASK.id,
  agentSnapshot: BUILDER,
  kind: "direct",
  status: "reported",
  acceptance: "accepted",
  prompt: "实现",
  output: "Agent 报告",
  createdAt: "2026-07-18T00:01:00.000Z",
  updatedAt: "2026-07-18T00:03:00.000Z",
  completedAt: "2026-07-18T00:03:00.000Z",
});

const COMMENTS: readonly TaskComment[] = Object.freeze([
  Object.freeze({ id: "message-user", taskId: TASK.id, author: "user", messageKind: "comment", body: "补充上下文", createdAt: "2026-07-18T00:00:30.000Z" }),
  Object.freeze({ id: "message-output", taskId: TASK.id, author: "agent", authorAgentId: "builder", messageKind: "execution-report", agentTaskId: AGENT_TASK.id, body: "Agent 报告", createdAt: "2026-07-18T00:03:00.000Z" }),
  Object.freeze({ id: "message-review", taskId: TASK.id, author: "system", messageKind: "acceptance", agentTaskId: AGENT_TASK.id, body: "用户接受执行报告", createdAt: "2026-07-18T00:04:00.000Z" }),
]);

const ACTIVITIES: readonly TaskActivity[] = Object.freeze([
  Object.freeze({ id: "activity-dispatch", taskId: TASK.id, runId: RUN.id, kind: "dispatch", summary: "已分发", createdAt: "2026-07-18T00:01:00.000Z" }),
]);

describe("projectTaskTimeline", () => {
  it("projects every task fact into visually distinct kinds with stable provenance", () => {
    const timeline = projectTaskTimeline({ task: TASK, comments: COMMENTS, activities: ACTIVITIES, runs: [RUN], agentTasks: [AGENT_TASK] });

    expect(timeline.map((item) => item.kind)).toEqual(expect.arrayContaining([
      "goal", "user-message", "agent-output", "dispatch-receipt", "execution", "artifact", "review",
    ]));
    expect(timeline.find((item) => item.id === `workflow-run:${RUN.id}`)?.provenance).toEqual({ source: "workflow-run", sourceId: RUN.id, runId: RUN.id });
    expect(timeline.find((item) => item.id === "workflow-step:step-run-1:artifact")?.provenance).toEqual({
      source: "workflow-step", sourceId: "step-run-1", runId: RUN.id, stepId: RUN.steps[0]?.stepId,
    });
    expect(timeline.find((item) => item.id === `agent-task:${AGENT_TASK.id}`)?.provenance.agentTaskId).toBe(AGENT_TASK.id);
    expect(timeline.filter((item) => item.id === `agent-task:${AGENT_TASK.id}:output`)).toHaveLength(0);
    expect(Object.isFrozen(timeline)).toBe(true);
    expect(Object.isFrozen(timeline[0]?.provenance)).toBe(true);
  });

  it("orders equal timestamps by kind and immutable id without mutating inputs", () => {
    const comments = Object.freeze([
      Object.freeze({ id: "z", taskId: TASK.id, author: "user" as const, body: "Z", createdAt: TASK.createdAt }),
      Object.freeze({ id: "a", taskId: TASK.id, author: "user" as const, body: "A", createdAt: TASK.createdAt }),
    ]);
    const before = comments.map((comment) => comment.id);
    const first = projectTaskTimeline({ task: TASK, comments, activities: [], runs: [], agentTasks: [] });
    const second = projectTaskTimeline({ task: TASK, comments, activities: [], runs: [], agentTasks: [] });

    expect(first.map((item) => item.id)).toEqual(["task:task-1", "message:a", "message:z"]);
    expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(comments.map((comment) => comment.id)).toEqual(before);
  });

  it("exposes invalid timestamps instead of silently reordering corrupt facts", () => {
    expect(() => projectTaskTimeline({ ...{ task: { ...TASK, createdAt: "invalid" } }, comments: [], activities: [], runs: [], agentTasks: [] }))
      .toThrow("Task timeline 条目 task:task-1 的时间无效");
  });
});

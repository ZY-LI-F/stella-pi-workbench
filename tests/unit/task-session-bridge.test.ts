import { describe, expect, it } from "vitest";
import { BOARD_SCHEMA_VERSION, EMPTY_BOARD_STATE, type AgentTask, type KanbanTask, type WorkflowRun } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { resolveTaskSessionTarget } from "../../src/shared/task-session-bridge";

const AGENT = BUILTIN_ORCHESTRATION_CATALOG.agents[0];
const WORKFLOW = BUILTIN_ORCHESTRATION_CATALOG.workflows[0];
if (!AGENT || !WORKFLOW) throw new Error("测试编排目录为空");

const TASK: KanbanTask = Object.freeze({
  id: "task-1", title: "桥接", description: "", acceptanceCriteria: "", priority: "medium",
  projectPath: "C:/Project", projectName: "Project", trusted: true,
  executionTarget: Object.freeze({ kind: "agent", agentId: AGENT.id }), stage: "planned",
  sourcePiSessionPath: "C:/Sessions/source.jsonl", sourcePiSessionId: "source",
  createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z",
});

const RUN: WorkflowRun = Object.freeze({
  id: "run-1", taskId: TASK.id, workflow: WORKFLOW, agents: Object.freeze([AGENT]), status: "reported", acceptance: "pending",
  steps: Object.freeze([Object.freeze({ id: "step-run-1", stepId: "step-1", stepKind: "agent", name: "实现", status: "succeeded", sessionPath: "C:/Sessions/workflow.jsonl", startedAt: "2026-07-18T00:00:00.000Z", completedAt: "2026-07-18T00:01:00.000Z" })]),
  startedAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:01:00.000Z",
});

const AGENT_TASK: AgentTask = Object.freeze({
  id: "agent-task-1", taskId: TASK.id, agentSnapshot: AGENT, kind: "direct", status: "reported", acceptance: "pending", prompt: "执行",
  sessionPath: "C:/Sessions/agent.jsonl", createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:01:00.000Z",
});

const STATE = Object.freeze({ ...EMPTY_BOARD_STATE, version: BOARD_SCHEMA_VERSION, tasks: Object.freeze([TASK]), runs: Object.freeze([RUN]), agentTasks: Object.freeze([AGENT_TASK]) });
const canonicalize = (path: string) => path.replaceAll("\\", "/").toLocaleLowerCase();

describe("resolveTaskSessionTarget", () => {
  it.each(["C:/Sessions/source.jsonl", "C:/Sessions/workflow.jsonl", "C:/Sessions/agent.jsonl"])("allows an explicitly selected persisted task session: %s", (sessionPath) => {
    expect(resolveTaskSessionTarget(STATE, { taskId: TASK.id, sessionPath: sessionPath.toLocaleLowerCase() }, canonicalize)).toEqual({
      taskId: TASK.id, projectPath: TASK.projectPath, trusted: true, sessionPath,
    });
  });

  it("rejects arbitrary renderer-provided session paths", () => {
    expect(() => resolveTaskSessionTarget(STATE, { taskId: TASK.id, sessionPath: "C:/Sessions/other.jsonl" }, canonicalize))
      .toThrow("所选 Pi session 不属于该任务的来源或执行记录");
  });
});

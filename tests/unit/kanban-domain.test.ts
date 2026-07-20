import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS,
  BOARD_SCHEMA_VERSION,
  canMoveTaskManually,
  parseBoardState,
  workflowProgress,
  type KanbanTask,
  type WorkflowRun,
} from "../../src/shared/kanban";

const task: KanbanTask = Object.freeze({
  id: "task-1",
  title: "升级看板",
  description: "",
  acceptanceCriteria: "",
  priority: "high",
  projectPath: "C:/project",
  projectName: "project",
  trusted: true,
  executionTarget: { kind: "workflow", workflowId: "feature-delivery" },
  stage: "planned",
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
});

function boardWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    version: BOARD_SCHEMA_VERSION,
    tasks: [task],
    runs: [],
    activities: [],
    comments: [],
    agentTasks: [],
    customAgents: [],
    squads: [],
    autopilots: [],
    autopilotRuns: [],
    ...overrides,
  };
}

function activityOf(kind: string, index: number): Record<string, unknown> {
  return {
    id: `activity-${index}`,
    taskId: task.id,
    kind,
    summary: "看板事件",
    createdAt: "2026-07-17T00:00:00.000Z",
  };
}

function customAgentWith(callsign: string): Record<string, unknown> {
  return {
    id: "custom-probe",
    version: 1,
    name: "探针 Agent",
    callsign,
    responsibility: "验证呼号规则",
    instructions: "只读验证",
    workspaceAccess: "read",
    allowedTools: ["read"],
    thinking: "low",
    disableExtensions: true,
    disableSkills: true,
    disablePromptTemplates: true,
    projectPath: "C:/project",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}

describe("kanban domain", () => {
  it("only allows inactive tasks into truthful manual lanes", () => {
    expect(canMoveTaskManually(task, "blocked")).toBe(true);
    expect(canMoveTaskManually(task, "running")).toBe(false);
    expect(canMoveTaskManually({ ...task, activeRunId: "run-1" }, "planned")).toBe(false);
  });

  it("calculates progress from succeeded steps", () => {
    const run = {
      steps: [
        { status: "succeeded" },
        { status: "succeeded" },
        { status: "running" },
        { status: "pending" },
      ],
    } as unknown as WorkflowRun;
    expect(workflowProgress(run)).toBe(50);
  });

  it("accepts every exported activity kind and rejects outsiders", () => {
    const activities = ACTIVITY_KINDS.map((kind, index) => activityOf(kind, index));
    const state = parseBoardState(boardWith({ activities }));
    expect(state.activities).toHaveLength(ACTIVITY_KINDS.length);
    expect(() => parseBoardState(boardWith({ activities: [activityOf("bogus", 0)] })))
      .toThrow("activities[0].kind 的值 bogus 无效");
  });

  it("rejects callsigns that can never match the mention charset", () => {
    const state = parseBoardState(boardWith({ customAgents: [customAgentWith("PROBE_2-X")] }));
    expect(state.customAgents[0]?.callsign).toBe("PROBE_2-X");
    expect(() => parseBoardState(boardWith({ customAgents: [customAgentWith("probe 侦察")] })))
      .toThrow("customAgents[0].callsign 只能包含大写英文字母、数字、下划线或连字符");
  });

  it("rejects malformed persisted state instead of silently repairing it", () => {
    expect(() => parseBoardState({ version: BOARD_SCHEMA_VERSION, tasks: "bad", runs: [], activities: [] }))
      .toThrow("缺少 tasks 数组");
    expect(() => parseBoardState({ version: 99, tasks: [], runs: [], activities: [] }))
      .toThrow("不支持的看板版本");
    expect(() => parseBoardState(boardWith({ tasks: [task, { ...task }] })))
      .toThrow("重复任务 id");
  });
});

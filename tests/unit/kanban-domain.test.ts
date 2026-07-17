import { describe, expect, it } from "vitest";
import {
  BOARD_SCHEMA_VERSION,
  boardLaneForStatus,
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
  workflowId: "feature-delivery",
  status: "planned",
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
});

describe("kanban domain", () => {
  it("maps failure states to the blocked lane without erasing the real status", () => {
    expect(boardLaneForStatus("failed")).toBe("blocked");
    expect(boardLaneForStatus("interrupted")).toBe("blocked");
    expect(boardLaneForStatus("review")).toBe("review");
  });

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

  it("rejects malformed persisted state instead of silently repairing it", () => {
    expect(() => parseBoardState({ version: BOARD_SCHEMA_VERSION, tasks: "bad", runs: [], activities: [] }))
      .toThrow("缺少 tasks、runs 或 activities");
    expect(() => parseBoardState({ version: 99, tasks: [], runs: [], activities: [] }))
      .toThrow("不支持的看板版本");
    expect(() => parseBoardState({
      version: BOARD_SCHEMA_VERSION,
      tasks: [task, { ...task }],
      runs: [],
      activities: [],
    })).toThrow("重复任务 id");
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BoardRepository } from "../../src/main/board-repository";
import { BoardService } from "../../src/main/board-service";
import { BOARD_SCHEMA_VERSION, parseBoardState, type BoardState } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

const NOW = "2026-07-18T00:00:00.000Z";

function initialState(): BoardState {
  return parseBoardState({
    version: BOARD_SCHEMA_VERSION,
    tasks: [{
      id: "task-autopilot", title: "Autopilot 产出任务", description: "", acceptanceCriteria: "", priority: "medium",
      projectPath: "C:/project", projectName: "project", trusted: true,
      executionTarget: { kind: "agent", agentId: "builder" }, stage: "planned", createdAt: NOW, updatedAt: NOW,
    }],
    runs: [],
    activities: [],
    comments: [],
    agentTasks: [],
    customAgents: [],
    squads: [],
    autopilots: [{
      id: "autopilot-1", name: "自动规则", enabled: true, trigger: { kind: "manual" },
      taskTemplate: { title: "模板", description: "", acceptanceCriteria: "", priority: "medium" },
      projectPath: "C:/project", projectName: "project", trusted: true,
      executionTarget: { kind: "agent", agentId: "builder" }, createdAt: NOW, updatedAt: NOW,
    }],
    autopilotRuns: [{
      id: "autopilot-run-1", autopilotId: "autopilot-1", triggerKind: "manual", status: "succeeded",
      taskId: "task-autopilot", startedAt: NOW, completedAt: NOW,
    }],
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

describe("BoardService", () => {
  it("preserves an AutopilotRun task reference as deletion provenance", async () => {
    const repository = new MemoryRepository();
    const service = new BoardService({
      repository,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: () => undefined,
      now: () => NOW,
      id: () => "board-id",
    });

    await service.deleteTask("task-autopilot");

    expect(repository.state.tasks).toEqual([]);
    expect(repository.state.autopilotRuns[0]).toMatchObject({ id: "autopilot-run-1", status: "succeeded" });
    expect(repository.state.autopilotRuns[0]?.taskId).toBe("task-autopilot");
  });
});

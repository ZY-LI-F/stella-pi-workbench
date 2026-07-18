// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BoardRepository } from "../../src/main/board-repository";
import { BoardService } from "../../src/main/board-service";
import { EMPTY_BOARD_STATE, parseBoardState, type BoardState, type CreateProjectAgentInput } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

const DRAFT: CreateProjectAgentInput = Object.freeze({
  name: "数据分析师",
  callsign: "DATA",
  responsibility: "分析项目数据并报告证据",
  instructions: "只读分析；记录输入与计算方法。",
  workspaceAccess: "read",
  allowedTools: Object.freeze(["read", "grep", "find", "ls"]),
  thinking: "high",
  disableExtensions: true,
  disableSkills: true,
  disablePromptTemplates: true,
  projectPath: "C:/project",
});

describe("project AgentDraft persistence", () => {
  it("creates a project-scoped Agent, exposes it in the catalog, and protects references", async () => {
    const repository = new MemoryRepository();
    let id = 0;
    const service = new BoardService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, now: () => "2026-07-18T04:00:00.000Z", id: () => `id-${++id}` });
    const created = await service.createProjectAgent(DRAFT);
    expect(created.board.customAgents[0]).toMatchObject({ id: "custom-data", callsign: "DATA", projectPath: "C:/project", version: 1 });
    expect(created.catalog.agents.some((agent) => agent.id === "custom-data")).toBe(true);

    await service.createTask({ title: "项目数据分析", description: "", acceptanceCriteria: "报告可复算", priority: "medium", projectPath: "C:/project", projectName: "project", trusted: true, executionTarget: { kind: "agent", agentId: "custom-data" } });
    await expect(service.deleteProjectAgent("custom-data")).rejects.toThrow("仍有任务引用");
    await expect(service.createTask({ title: "越权使用", description: "", acceptanceCriteria: "", priority: "low", projectPath: "C:/other", projectName: "other", trusted: true, executionTarget: { kind: "agent", agentId: "custom-data" } })).rejects.toThrow("属于其他项目");
  });

  it("rejects write-capable tools in a read-only AgentDraft", async () => {
    const service = new BoardService({ repository: new MemoryRepository(), catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined });
    await expect(service.createProjectAgent({ ...DRAFT, callsign: "UNSAFE", allowedTools: ["read", "bash"] })).rejects.toThrow("只读 Agent 不能启用");
  });
});

// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { BoardStore } from "../../src/main/board-store";
import { BOARD_SCHEMA_VERSION, type BoardState } from "../../src/shared/kanban";

const temporaryDirectories: string[] = [];

async function temporaryBoardPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "stella-board-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "board", "board.json");
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("BoardStore", () => {
  it("persists transactional updates as validated JSON", async () => {
    const path = await temporaryBoardPath();
    const store = new BoardStore(path);
    await store.initialize();
    await store.update((current) => ({ ...current, activities: [] }));
    const parsed = JSON.parse(await readFile(path, "utf8")) as BoardState;
    expect(parsed.version).toBe(BOARD_SCHEMA_VERSION);
    expect(parsed.tasks).toEqual([]);
  });

  it("surfaces invalid JSON with its file path", async () => {
    const path = await temporaryBoardPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ nope", "utf8");
    await expect(new BoardStore(path).initialize()).rejects.toThrow(`无法解析看板文件 ${path}`);
  });

  it("marks queued work interrupted after restart", async () => {
    const path = await temporaryBoardPath();
    const now = "2026-07-17T01:00:00.000Z";
    const state: BoardState = {
      version: BOARD_SCHEMA_VERSION,
      tasks: [{
        id: "task-1", title: "运行中任务", description: "", acceptanceCriteria: "", priority: "medium",
        projectPath: "C:/project", projectName: "project", trusted: true, workflowId: "flow", status: "queued",
        activeRunId: "run-1", createdAt: now, updatedAt: now,
      }],
      runs: [{
        id: "run-1", taskId: "task-1", status: "queued", startedAt: now, updatedAt: now,
        workflow: { id: "flow", version: 1, name: "流程", shortName: "流程", summary: "测试", teamId: "team", steps: [{ kind: "agent", id: "step", name: "步骤", summary: "", agentId: "agent", objective: "执行" }] },
        agents: [{ id: "agent", version: 1, name: "Agent", callsign: "A", responsibility: "测试", instructions: "测试", workspaceAccess: "read", allowedTools: ["read"], thinking: "off", disableExtensions: true, disableSkills: true, disablePromptTemplates: true }],
        currentStepId: "step",
        steps: [{ id: "step-run", stepId: "step", stepKind: "agent", name: "步骤", status: "pending", agentId: "agent" }],
      }],
      activities: [],
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(state), "utf8");
    let id = 0;
    const recovered = await new BoardStore(path, { now: () => now, id: () => `recovery-${++id}` }).initialize();
    expect(recovered.tasks[0]?.status).toBe("interrupted");
    expect(recovered.tasks[0]?.activeRunId).toBeUndefined();
    expect(recovered.runs[0]?.status).toBe("interrupted");
    expect(recovered.activities[0]?.summary).toContain("应用重启");
  });
});

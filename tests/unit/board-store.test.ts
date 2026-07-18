// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { BoardStore } from "../../src/main/board-store";
import { BOARD_SCHEMA_VERSION, EMPTY_BOARD_STATE, type AgentDefinition, type BoardState } from "../../src/shared/kanban";

const TEST_AGENT: AgentDefinition = Object.freeze({
  id: "agent", version: 1, name: "Agent", callsign: "A", responsibility: "测试", instructions: "测试",
  workspaceAccess: "read", allowedTools: Object.freeze(["read"]), thinking: "off",
  disableExtensions: true, disableSkills: true, disablePromptTemplates: true,
});

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
      ...EMPTY_BOARD_STATE,
      tasks: [{
        id: "task-1", title: "运行中任务", description: "", acceptanceCriteria: "", priority: "medium",
        projectPath: "C:/project", projectName: "project", trusted: true,
        executionTarget: { kind: "workflow", workflowId: "flow" }, status: "queued",
        activeRunId: "run-1", createdAt: now, updatedAt: now,
      }],
      runs: [{
        id: "run-1", taskId: "task-1", status: "queued", startedAt: now, updatedAt: now,
        workflow: { id: "flow", version: 1, name: "流程", shortName: "流程", summary: "测试", teamId: "team", steps: [{ kind: "agent", id: "step", name: "步骤", summary: "", agentId: "agent", objective: "执行" }] },
        agents: [TEST_AGENT],
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

  it("migrates schema v1 after creating a timestamped backup", async () => {
    const path = await temporaryBoardPath();
    const now = "2026-07-17T01:00:00.000Z";
    const legacy = {
      version: 1,
      tasks: [{
        id: "task-legacy", title: "旧任务", description: "", acceptanceCriteria: "", priority: "medium",
        projectPath: "C:/project", projectName: "project", trusted: true, workflowId: "flow", status: "planned",
        createdAt: now, updatedAt: now,
      }],
      runs: [],
      activities: [],
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(legacy), "utf8");
    const migrated = await new BoardStore(path, { now: () => now, id: () => "backup-id" }).initialize();
    expect(migrated.version).toBe(2);
    expect(migrated.tasks[0]?.executionTarget).toEqual({ kind: "workflow", workflowId: "flow" });
    expect(migrated.comments).toEqual([]);
    const files = await readdir(dirname(path));
    expect(files.some((file) => file.includes(".v1.2026-07-17T01-00-00.000Z.backup-id.bak"))).toBe(true);
  });

  it("preserves queued agent work and interrupts only a running AgentTask on restart", async () => {
    const path = await temporaryBoardPath();
    const now = "2026-07-17T01:00:00.000Z";
    const state: BoardState = {
      ...EMPTY_BOARD_STATE,
      tasks: [
        {
          id: "task-running", title: "运行中", description: "", acceptanceCriteria: "", priority: "medium",
          projectPath: "C:/project", projectName: "project", trusted: true,
          executionTarget: { kind: "agent", agentId: "agent" }, status: "running", activeAgentTaskId: "agent-task-running",
          createdAt: now, updatedAt: now,
        },
        {
          id: "task-queued", title: "排队中", description: "", acceptanceCriteria: "", priority: "medium",
          projectPath: "C:/project", projectName: "project", trusted: true,
          executionTarget: { kind: "agent", agentId: "agent" }, status: "queued", activeAgentTaskId: "agent-task-queued",
          createdAt: now, updatedAt: now,
        },
      ],
      agentTasks: [
        {
          id: "agent-task-running", taskId: "task-running", agentSnapshot: TEST_AGENT, kind: "direct", status: "running",
          prompt: "执行", runtimeToken: "runtime", createdAt: now, updatedAt: now, startedAt: now,
        },
        {
          id: "agent-task-queued", taskId: "task-queued", agentSnapshot: TEST_AGENT, kind: "direct", status: "queued",
          prompt: "等待", createdAt: now, updatedAt: now,
        },
      ],
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(state), "utf8");
    let id = 0;
    const recovered = await new BoardStore(path, { now: () => now, id: () => `recovery-${++id}` }).initialize();
    expect(recovered.agentTasks.find((task) => task.id === "agent-task-running")?.status).toBe("interrupted");
    expect(recovered.tasks.find((task) => task.id === "task-running")?.activeAgentTaskId).toBeUndefined();
    expect(recovered.agentTasks.find((task) => task.id === "agent-task-queued")?.status).toBe("queued");
    expect(recovered.tasks.find((task) => task.id === "task-queued")?.activeAgentTaskId).toBe("agent-task-queued");
  });

  it("keeps a malformed v1 source untouched and reports its backup", async () => {
    const path = await temporaryBoardPath();
    const source = JSON.stringify({ version: 1, tasks: [{ id: "broken" }], runs: [], activities: [] });
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source, "utf8");
    const store = new BoardStore(path, { now: () => "2026-07-17T01:00:00.000Z", id: () => "backup-id" });
    await expect(store.initialize()).rejects.toThrow("原文件未修改，备份位于");
    expect(await readFile(path, "utf8")).toBe(source);
    expect((await readdir(dirname(path))).some((file) => file.endsWith(".bak"))).toBe(true);
  });
});

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
        executionTarget: { kind: "workflow", workflowId: "flow" }, stage: "queued",
        activeRunId: "run-1", createdAt: now, updatedAt: now,
      }],
      runs: [{
        id: "run-1", taskId: "task-1", status: "queued", acceptance: "not-ready", startedAt: now, updatedAt: now,
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
    expect(recovered.tasks[0]?.stage).toBe("blocked");
    expect(recovered.tasks[0]?.blockedReason).toContain("应用重启");
    expect(recovered.tasks[0]?.activeRunId).toBeUndefined();
    expect(recovered.runs[0]?.status).toBe("interrupted");
    expect(recovered.activities[0]?.summary).toContain("应用重启");
  });

  it("marks a leftover running AutopilotRun failed after restart", async () => {
    const path = await temporaryBoardPath();
    const now = "2026-07-17T01:00:00.000Z";
    const state: BoardState = {
      ...EMPTY_BOARD_STATE,
      autopilots: [{
        id: "autopilot-1", name: "自动规则", enabled: true, trigger: { kind: "manual" },
        taskTemplate: { title: "模板", description: "", acceptanceCriteria: "", priority: "medium" },
        projectPath: "C:/project", projectName: "project", trusted: true,
        executionTarget: { kind: "agent", agentId: "agent" }, createdAt: now, updatedAt: now,
      }],
      autopilotRuns: [{ id: "autopilot-run-1", autopilotId: "autopilot-1", triggerKind: "webhook", status: "running", startedAt: now }],
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(state), "utf8");
    const recovered = await new BoardStore(path, { now: () => now, id: () => "recovery-id" }).initialize();
    expect(recovered.autopilotRuns[0]).toMatchObject({ status: "failed", error: "应用重启，执行中断", completedAt: now });
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
    expect(migrated.version).toBe(BOARD_SCHEMA_VERSION);
    expect(migrated.tasks[0]?.executionTarget).toEqual({ kind: "workflow", workflowId: "flow" });
    expect(migrated.comments).toEqual([]);
    const files = await readdir(dirname(path));
    expect(files.some((file) => file.includes(".v1.2026-07-17T01-00-00.000Z.backup-id.bak"))).toBe(true);
  });

  it("migrates schema v2 to the current version without losing automation history", async () => {
    const path = await temporaryBoardPath();
    const now = "2026-07-17T01:00:00.000Z";
    const legacyV2 = {
      version: 2,
      tasks: [{
        id: "task-v2", title: "v2 任务", description: "说明", acceptanceCriteria: "验收", priority: "high",
        projectPath: "C:/project", projectName: "project", trusted: true,
        executionTarget: { kind: "agent", agentId: "agent" }, status: "completed", createdAt: now, updatedAt: now,
      }],
      runs: [{
        id: "run-v2", taskId: "task-v2", status: "completed", startedAt: now, updatedAt: now, completedAt: now,
        workflow: { id: "flow", version: 1, name: "流程", shortName: "流程", summary: "测试", teamId: "team", steps: [{ kind: "agent", id: "step", name: "步骤", summary: "", agentId: "agent", objective: "执行" }] },
        agents: [TEST_AGENT],
        steps: [{ id: "step-run", stepId: "step", stepKind: "agent", name: "步骤", status: "succeeded", agentId: "agent", completedAt: now }],
      }],
      activities: [{ id: "activity-v2", taskId: "task-v2", runId: "run-v2", kind: "artifact", summary: "已有产物", createdAt: now }],
      comments: [{ id: "comment-v2", taskId: "task-v2", author: "user", body: "保留评论", createdAt: now }],
      agentTasks: [{
        id: "agent-task-v2", taskId: "task-v2", agentSnapshot: TEST_AGENT, kind: "direct", status: "succeeded",
        prompt: "执行", output: "历史结果", sessionPath: "C:/session.jsonl", createdAt: now, updatedAt: now, completedAt: now,
      }],
      squads: [{
        id: "squad-v2", name: "历史 Squad", description: "保留", leaderAgentId: "leader", memberAgentIds: ["agent"],
        leaderInstructions: "分发", createdAt: now, updatedAt: now,
      }],
      autopilots: [{
        id: "autopilot-v2", name: "历史规则", enabled: true, trigger: { kind: "manual" },
        taskTemplate: { title: "模板", description: "", acceptanceCriteria: "", priority: "medium" },
        projectPath: "C:/project", projectName: "project", trusted: true,
        executionTarget: { kind: "agent", agentId: "agent" }, createdAt: now, updatedAt: now,
      }],
      autopilotRuns: [{
        id: "autopilot-run-v2", autopilotId: "autopilot-v2", triggerKind: "manual", status: "succeeded",
        taskId: "task-v2", startedAt: now, completedAt: now,
      }],
    };
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(legacyV2), "utf8");

    const migrated = await new BoardStore(path, { now: () => now, id: () => "backup-id" }).initialize();

    expect(migrated.version).toBe(BOARD_SCHEMA_VERSION);
    expect(migrated.customAgents).toEqual([]);
    expect(migrated.tasks[0]).toMatchObject({ id: "task-v2", stage: "completed" });
    expect(migrated.runs[0]).toMatchObject({ id: "run-v2", status: "reported", acceptance: "pending" });
    expect(migrated.agentTasks[0]).toMatchObject({ id: "agent-task-v2", status: "reported", acceptance: "pending", output: "历史结果" });
    expect(migrated.comments[0]?.body).toBe("保留评论");
    expect(migrated.activities[0]?.summary).toBe("已有产物");
    expect(migrated.squads[0]?.name).toBe("历史 Squad");
    expect(migrated.autopilots[0]?.name).toBe("历史规则");
    expect(migrated.autopilotRuns[0]?.id).toBe("autopilot-run-v2");
    expect((await readdir(dirname(path))).some((file) => file.includes(".v2.2026-07-17T01-00-00.000Z.backup-id.bak"))).toBe(true);
  });

  it("migrates an installed schema v3 board and adds the project Agent collection", async () => {
    const path = await temporaryBoardPath();
    const now = "2026-07-17T01:00:00.000Z";
    const { customAgents: _customAgents, version: _version, ...v3Collections } = EMPTY_BOARD_STATE;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ ...v3Collections, version: 3 }), "utf8");

    const migrated = await new BoardStore(path, { now: () => now, id: () => "backup-id" }).initialize();

    expect(migrated.version).toBe(BOARD_SCHEMA_VERSION);
    expect(migrated.customAgents).toEqual([]);
    expect((await readdir(dirname(path))).some((file) => file.includes(".v3.2026-07-17T01-00-00.000Z.backup-id.bak"))).toBe(true);
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
          executionTarget: { kind: "agent", agentId: "agent" }, stage: "running", activeAgentTaskId: "agent-task-running",
          createdAt: now, updatedAt: now,
        },
        {
          id: "task-queued", title: "排队中", description: "", acceptanceCriteria: "", priority: "medium",
          projectPath: "C:/project", projectName: "project", trusted: true,
          executionTarget: { kind: "agent", agentId: "agent" }, stage: "queued", activeAgentTaskId: "agent-task-queued",
          createdAt: now, updatedAt: now,
        },
      ],
      agentTasks: [
        {
          id: "agent-task-running", taskId: "task-running", agentSnapshot: TEST_AGENT, kind: "direct", status: "running", acceptance: "not-ready",
          prompt: "执行", runtimeToken: "runtime", createdAt: now, updatedAt: now, startedAt: now,
        },
        {
          id: "agent-task-queued", taskId: "task-queued", agentSnapshot: TEST_AGENT, kind: "direct", status: "queued", acceptance: "not-ready",
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

const CAP_NOW = "2026-07-17T01:00:00.000Z";

function capTask(id: string): BoardState["tasks"][number] {
  return {
    id, title: `任务 ${id}`, description: "", acceptanceCriteria: "", priority: "medium",
    projectPath: "C:/project", projectName: "project", trusted: true,
    executionTarget: { kind: "workflow", workflowId: "flow" }, stage: "planned",
    createdAt: CAP_NOW, updatedAt: CAP_NOW,
  };
}

function capActivity(id: string, taskId: string): BoardState["activities"][number] {
  return { id, taskId, kind: "status", summary: `活动 ${id}`, createdAt: CAP_NOW };
}

function capComment(id: string, taskId: string): BoardState["comments"][number] {
  return { id, taskId, author: "user", body: `评论 ${id}`, createdAt: CAP_NOW };
}

function capRun(id: string, taskId: string): BoardState["runs"][number] {
  return {
    id, taskId, status: "reported", acceptance: "pending", startedAt: CAP_NOW, updatedAt: CAP_NOW, completedAt: CAP_NOW,
    workflow: { id: "flow", version: 1, name: "流程", shortName: "流程", summary: "测试", teamId: "team", steps: [{ kind: "agent", id: "step", name: "步骤", summary: "", agentId: "agent", objective: "执行" }] },
    agents: [TEST_AGENT],
    steps: [{ id: `${id}-step`, stepId: "step", stepKind: "agent", name: "步骤", status: "succeeded", agentId: "agent", completedAt: CAP_NOW }],
  };
}

const CAP_AUTOPILOT: BoardState["autopilots"][number] = {
  id: "autopilot-1", name: "自动规则", enabled: true, trigger: { kind: "manual" },
  taskTemplate: { title: "模板", description: "", acceptanceCriteria: "", priority: "medium" },
  projectPath: "C:/project", projectName: "project", trusted: true,
  executionTarget: { kind: "agent", agentId: "agent" }, createdAt: CAP_NOW, updatedAt: CAP_NOW,
};

function capAutopilotRun(id: string, status: BoardState["autopilotRuns"][number]["status"] = "succeeded"): BoardState["autopilotRuns"][number] {
  const base = { id, autopilotId: "autopilot-1", triggerKind: "manual" as const, status, startedAt: CAP_NOW };
  return status === "running" ? base : { ...base, completedAt: CAP_NOW };
}

describe("BoardStore append-only audit history", () => {
  it("retains every activity for every task in its original order", async () => {
    const path = await temporaryBoardPath();
    const store = new BoardStore(path);
    await store.initialize();
    const oldestA = Array.from({ length: 5 }, (_, index) => capActivity(`a-${index + 1}`, "task-a"));
    const newestA = Array.from({ length: 200 }, (_, index) => capActivity(`a-${index + 6}`, "task-a"));
    const state: BoardState = {
      ...EMPTY_BOARD_STATE,
      tasks: [capTask("task-a"), capTask("task-b")],
      activities: [...oldestA, capActivity("b-1", "task-b"), ...newestA, capActivity("b-2", "task-b")],
    };
    const next = await store.update(() => state);
    expect(next.activities).toHaveLength(207);
    expect(next.activities[0]?.id).toBe("a-1");
    expect(next.activities[5]?.id).toBe("b-1");
    expect(next.activities[6]?.id).toBe("a-6");
    expect(next.activities[205]?.id).toBe("a-205");
    expect(next.activities[206]?.id).toBe("b-2");
    expect(next.activities.filter((activity) => activity.taskId === "task-b").map((activity) => activity.id)).toEqual(["b-1", "b-2"]);
    const persisted = JSON.parse(await readFile(path, "utf8")) as BoardState;
    expect(persisted.activities.map((activity) => activity.id)).toEqual(next.activities.map((activity) => activity.id));
  });

  it("retains every completed AutopilotRun in stored order", async () => {
    const store = new BoardStore(await temporaryBoardPath());
    await store.initialize();
    const runs = Array.from({ length: 105 }, (_, index) => capAutopilotRun(`run-${105 - index}`));
    const next = await store.update(() => ({ ...EMPTY_BOARD_STATE, autopilots: [CAP_AUTOPILOT], autopilotRuns: runs }));
    expect(next.autopilotRuns).toHaveLength(105);
    expect(next.autopilotRuns[0]?.id).toBe("run-105");
    expect(next.autopilotRuns[104]?.id).toBe("run-1");
  });

  it("retains running AutopilotRuns together with all completed history", async () => {
    const store = new BoardStore(await temporaryBoardPath());
    await store.initialize();
    const runs = [
      ...Array.from({ length: 104 }, (_, index) => capAutopilotRun(`run-${105 - index}`)),
      capAutopilotRun("run-1", "running"),
    ];
    const next = await store.update(() => ({ ...EMPTY_BOARD_STATE, autopilots: [CAP_AUTOPILOT], autopilotRuns: runs }));
    expect(next.autopilotRuns).toHaveLength(105);
    expect(next.autopilotRuns[0]?.id).toBe("run-105");
    expect(next.autopilotRuns[103]?.id).toBe("run-2");
    expect(next.autopilotRuns[104]).toMatchObject({ id: "run-1", status: "running" });
  });

  it("never prunes comments or workflow runs regardless of volume", async () => {
    const store = new BoardStore(await temporaryBoardPath());
    await store.initialize();
    const comments = Array.from({ length: 250 }, (_, index) => capComment(`comment-${index + 1}`, "task-a"));
    const runs = Array.from({ length: 120 }, (_, index) => capRun(`run-${index + 1}`, "task-a"));
    const next = await store.update(() => ({ ...EMPTY_BOARD_STATE, tasks: [capTask("task-a")], comments, runs }));
    expect(next.comments).toHaveLength(250);
    expect(next.runs).toHaveLength(120);
    expect(next.comments[0]?.id).toBe("comment-1");
    expect(next.comments[249]?.id).toBe("comment-250");
    expect(next.runs[0]?.id).toBe("run-1");
    expect(next.runs[119]?.id).toBe("run-120");
  });

  it("keeps an unchanged write byte-identical", async () => {
    const path = await temporaryBoardPath();
    const store = new BoardStore(path);
    await store.initialize();
    const state: BoardState = {
      ...EMPTY_BOARD_STATE,
      tasks: [capTask("task-a")],
      activities: [capActivity("a-1", "task-a"), capActivity("a-2", "task-a")],
      autopilots: [CAP_AUTOPILOT],
      autopilotRuns: [capAutopilotRun("run-2"), capAutopilotRun("run-1")],
    };
    await store.update(() => state);
    const before = await readFile(path, "utf8");
    await store.update((current) => current);
    const after = await readFile(path, "utf8");
    expect(after).toBe(before);
    const persisted = JSON.parse(after) as BoardState;
    expect(persisted.activities.map((activity) => activity.id)).toEqual(["a-1", "a-2"]);
    expect(persisted.autopilotRuns.map((run) => run.id)).toEqual(["run-2", "run-1"]);
  });
});

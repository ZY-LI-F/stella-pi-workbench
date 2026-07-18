import { describe, expect, it } from "vitest";
import { deriveAgentPresences } from "../../src/shared/agent-presence";
import { BOARD_SCHEMA_VERSION, parseBoardState, type ProjectAgentDefinition } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG, catalogForBoard } from "../../src/shared/orchestration-catalog";

const NOW = "2026-07-18T03:00:00.000Z";
const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
const lead = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "lead");
if (!builder || !lead) throw new Error("测试目录缺少 builder 或 lead");

function customAgent(id: string, projectPath: string): ProjectAgentDefinition {
  return Object.freeze({
    id,
    version: 1,
    name: id,
    callsign: id.toLocaleUpperCase(),
    responsibility: "项目专用研究",
    instructions: "只报告真实证据",
    workspaceAccess: "read",
    allowedTools: Object.freeze(["read"]),
    thinking: "medium",
    disableExtensions: true,
    disableSkills: true,
    disablePromptTemplates: true,
    projectPath,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("Agent Presence projection", () => {
  it("derives live state from executions and filters project-scoped Agents", () => {
    const state = parseBoardState({
      version: BOARD_SCHEMA_VERSION,
      tasks: [
        { id: "task-running", title: "实现", description: "", acceptanceCriteria: "", priority: "high", projectPath: "C:/one", projectName: "one", trusted: true, executionTarget: { kind: "agent", agentId: "builder" }, stage: "running", activeAgentTaskId: "builder-task", createdAt: NOW, updatedAt: NOW },
        { id: "task-waiting", title: "范围决定", description: "", acceptanceCriteria: "", priority: "medium", projectPath: "C:/one", projectName: "one", trusted: true, executionTarget: { kind: "agent", agentId: "lead" }, stage: "review", activeAgentTaskId: "lead-task", createdAt: NOW, updatedAt: NOW },
      ],
      runs: [],
      activities: [],
      comments: [],
      agentTasks: [
        { id: "builder-task", taskId: "task-running", agentSnapshot: builder, kind: "direct", status: "running", acceptance: "not-ready", prompt: "执行", runtimeToken: "runtime", createdAt: NOW, updatedAt: NOW, startedAt: NOW },
        { id: "lead-task", taskId: "task-waiting", agentSnapshot: lead, kind: "coordinator", status: "waiting_human", acceptance: "not-ready", prompt: "规划", output: "{}", createdAt: NOW, updatedAt: NOW, startedAt: NOW },
      ],
      customAgents: [customAgent("custom-one", "C:/one"), customAgent("custom-two", "C:/two")],
      squads: [],
      autopilots: [],
      autopilotRuns: [],
    });
    const catalog = catalogForBoard(BUILTIN_ORCHESTRATION_CATALOG, state);
    const presences = deriveAgentPresences(state, catalog, "C:/one");

    expect(presences.find((presence) => presence.agent.id === "builder")).toMatchObject({ state: "running", activeTaskId: "task-running", workload: 1 });
    expect(presences.find((presence) => presence.agent.id === "lead")).toMatchObject({ state: "waiting", activeTaskId: "task-waiting", detail: "等待用户回复" });
    expect(presences.find((presence) => presence.agent.id === "custom-one")).toMatchObject({ state: "available", workload: 0 });
    expect(presences.some((presence) => presence.agent.id === "custom-two")).toBe(false);
  });
});

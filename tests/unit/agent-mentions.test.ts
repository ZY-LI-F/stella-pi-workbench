import { describe, expect, it } from "vitest";
import {
  agentMentionQueryAtCaret,
  availableMentionAgentsForTask,
  filterMentionAgents,
  insertAgentMention,
  mentionedAgentIds,
  parseAgentMentions,
} from "../../src/shared/agent-mentions";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import type { KanbanTask, ProjectAgentDefinition, Squad } from "../../src/shared/kanban";

describe("parseAgentMentions", () => {
  it("resolves id and callsign case-insensitively in first-appearance order and deduplicates Agents", () => {
    const parsed = parseAgentMentions("先 @VERIFY，再 @builder，最后重复 @BUILD", BUILTIN_ORCHESTRATION_CATALOG.agents);
    expect(parsed.tokens).toEqual(["VERIFY", "builder", "BUILD"]);
    expect(parsed.agents.map((agent) => agent.id)).toEqual(["tester", "builder"]);
  });

  it("rejects unknown and ambiguous explicit mentions", () => {
    expect(() => parseAgentMentions("请交给 @missing", BUILTIN_ORCHESTRATION_CATALOG.agents)).toThrow("未知 Agent mention");
    const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
    if (!builder) throw new Error("缺少 builder 测试 Agent");
    const collision = Object.freeze({ ...builder, id: "build", callsign: "OTHER" });
    expect(() => parseAgentMentions("请交给 @build", [...BUILTIN_ORCHESTRATION_CATALOG.agents, collision])).toThrow("存在歧义");
  });

  it("does not interpret the @ inside an email address as delegation", () => {
    expect(parseAgentMentions("联系 stella@example.com", BUILTIN_ORCHESTRATION_CATALOG.agents).agents).toEqual([]);
  });

  it("discovers a Unicode mention query at the caret and filters by Chinese name or responsibility", () => {
    const text = "请让 @靶点";
    expect(agentMentionQueryAtCaret(text, text.length)).toEqual({ start: 3, end: text.length, query: "靶点" });
    expect(filterMentionAgents(BUILTIN_ORCHESTRATION_CATALOG.agents, "靶点").map((agent) => agent.id)).toEqual([
      "target-biologist",
      "target-strategist",
    ]);
    expect(filterMentionAgents(BUILTIN_ORCHESTRATION_CATALOG.agents, "评分").map((agent) => agent.id)).toContain("target-strategist");
    expect(agentMentionQueryAtCaret("联系 stella@example", "联系 stella@example".length)).toBeUndefined();
  });

  it("inserts the stable callsign at the exact query range and reports selected Agent ids", () => {
    const strategist = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "target-strategist");
    if (!strategist) throw new Error("缺少靶点策略负责人测试 Agent");
    const text = "请让 @策略 先讨论";
    const query = agentMentionQueryAtCaret(text, "请让 @策略".length);
    if (!query) throw new Error("测试 mention query 未被识别");
    const inserted = insertAgentMention(text, query, strategist);
    expect(inserted.value).toBe("请让 @STRATEGY 先讨论");
    expect(inserted.caret).toBe("请让 @STRATEGY ".length);
    expect([...mentionedAgentIds(inserted.value, BUILTIN_ORCHESTRATION_CATALOG.agents)]).toEqual(["target-strategist"]);
  });

  it("limits picker candidates to the current project and the selected Squad", () => {
    const builder = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
    if (!builder) throw new Error("缺少 builder 测试 Agent");
    const custom = (id: string, projectPath: string): ProjectAgentDefinition => Object.freeze({
      ...builder,
      id,
      name: id,
      callsign: id.toUpperCase(),
      projectPath,
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    });
    const task = Object.freeze({ projectPath: "C:/project", executionTarget: Object.freeze({ kind: "agent" as const, agentId: "builder" }) });
    const agents = [...BUILTIN_ORCHESTRATION_CATALOG.agents, custom("local", "C:/project"), custom("foreign", "D:/other")];
    expect(availableMentionAgentsForTask(task, { agents }, []).map((agent) => agent.id)).toContain("local");
    expect(availableMentionAgentsForTask(task, { agents }, []).map((agent) => agent.id)).not.toContain("foreign");

    const squad: Squad = Object.freeze({
      id: "delivery",
      name: "交付组",
      description: "测试范围",
      leaderAgentId: "builder",
      memberAgentIds: Object.freeze(["tester"]),
      leaderInstructions: "先实现再验证",
      createdAt: "2026-07-19T00:00:00.000Z",
      updatedAt: "2026-07-19T00:00:00.000Z",
    });
    const squadTask: Pick<KanbanTask, "executionTarget" | "projectPath"> = Object.freeze({ projectPath: "C:/project", executionTarget: Object.freeze({ kind: "squad", squadId: squad.id }) });
    expect(availableMentionAgentsForTask(squadTask, { agents }, [squad]).map((agent) => agent.id)).toEqual(["lead", "builder", "tester"]);
  });
});

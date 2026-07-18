import { describe, expect, it } from "vitest";
import { parseAgentMentions } from "../../src/shared/agent-mentions";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";

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
});

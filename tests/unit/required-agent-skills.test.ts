import { describe, expect, it, vi } from "vitest";
import type { PiCommand, PiResponse } from "../../src/shared/contracts";
import type { AgentDefinition } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { assertRequiredAgentSkills, requiredSkillsPrompt } from "../../src/main/required-agent-skills";

const DOMAIN_AGENT = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "target-biologist");
if (!DOMAIN_AGENT) throw new Error("测试目录缺少 target-biologist");

function runtimeWith(commands: readonly Record<string, unknown>[]) {
  return Object.freeze({
    send: vi.fn(async (command: PiCommand): Promise<PiResponse> => ({
      id: "commands",
      type: "response",
      command: command.type,
      success: true,
      data: { commands },
    } as PiResponse)),
  });
}

describe("required Agent skills", () => {
  it("preflights all required Pi skill commands before a domain Agent runs", async () => {
    const runtime = runtimeWith([
      { name: "skill:target-evidence", source: "skill" },
      { name: "unrelated", source: "prompt" },
    ]);
    await expect(assertRequiredAgentSkills(runtime, DOMAIN_AGENT)).resolves.toBeUndefined();
    expect(runtime.send).toHaveBeenCalledWith({ type: "get_commands" });
    expect(requiredSkillsPrompt(DOMAIN_AGENT)).toContain("skill:target-evidence");
  });

  it("fails with the exact missing names instead of starting with degraded behavior", async () => {
    const runtime = runtimeWith([{ name: "skill:other", source: "skill" }]);
    await expect(assertRequiredAgentSkills(runtime, DOMAIN_AGENT)).rejects.toThrow(
      "靶点生物学研究员 缺少必需 Pi Skills：target-evidence",
    );
  });

  it("rejects a contradictory disableSkills configuration without querying Pi", async () => {
    const agent: AgentDefinition = Object.freeze({ ...DOMAIN_AGENT, disableSkills: true });
    const runtime = runtimeWith([{ name: "skill:target-evidence", source: "skill" }]);
    await expect(assertRequiredAgentSkills(runtime, agent)).rejects.toThrow("disableSkills=true");
    expect(runtime.send).not.toHaveBeenCalled();
  });

  it("keeps generic Agents backward compatible and does not issue an unnecessary RPC call", async () => {
    const generic = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "scout");
    if (!generic) throw new Error("测试目录缺少 scout");
    const runtime = runtimeWith([]);
    await expect(assertRequiredAgentSkills(runtime, generic)).resolves.toBeUndefined();
    expect(runtime.send).not.toHaveBeenCalled();
    expect(requiredSkillsPrompt(generic)).toBe(generic.instructions);
  });

  it("keeps the medical team and workflow references complete", () => {
    const team = BUILTIN_ORCHESTRATION_CATALOG.teams.find((candidate) => candidate.id === "early-target-squad");
    const workflow = BUILTIN_ORCHESTRATION_CATALOG.workflows.find((candidate) => candidate.id === "early-target-assessment");
    expect(team?.roles).toHaveLength(4);
    expect(workflow?.steps.map((step) => step.id)).toEqual([
      "biology", "competition", "scope-review", "synthesis", "audit", "accept",
    ]);
    const agentIds = new Set(BUILTIN_ORCHESTRATION_CATALOG.agents.map((agent) => agent.id));
    expect(team?.roles.every((role) => agentIds.has(role.agentId))).toBe(true);
    expect(workflow?.steps.filter((step) => step.kind === "agent").every((step) => agentIds.has(step.agentId))).toBe(true);
  });
});

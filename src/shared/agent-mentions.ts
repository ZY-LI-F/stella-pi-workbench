import type { AgentDefinition, KanbanTask, OrchestrationCatalog, Squad } from "./kanban";

const MENTION_PATTERN = /(?:^|\s)@([A-Za-z0-9_-]+)/gu;

export interface ParsedAgentMentions {
  readonly tokens: readonly string[];
  readonly agents: readonly AgentDefinition[];
}

export function availableMentionAgentsForTask(
  task: Pick<KanbanTask, "executionTarget">,
  catalog: Pick<OrchestrationCatalog, "agents">,
  squads: readonly Squad[],
): readonly AgentDefinition[] {
  const executionTarget = task.executionTarget;
  if (executionTarget.kind !== "squad") return catalog.agents;
  const squad = squads.find((candidate) => candidate.id === executionTarget.squadId);
  if (!squad) throw new Error(`找不到 Squad: ${executionTarget.squadId}`);
  const agent = (agentId: string): AgentDefinition => {
    const definition = catalog.agents.find((candidate) => candidate.id === agentId);
    if (!definition) throw new Error(`未知 Agent: ${agentId}`);
    return definition;
  };
  return Object.freeze([agent(squad.leaderAgentId), ...squad.memberAgentIds.map(agent)]);
}

export function parseAgentMentions(text: string, availableAgents: readonly AgentDefinition[]): ParsedAgentMentions {
  const aliases = new Map<string, AgentDefinition[]>();
  for (const agent of availableAgents) {
    for (const alias of [agent.id, agent.callsign]) {
      const normalized = alias.toLocaleLowerCase();
      aliases.set(normalized, [...aliases.get(normalized) ?? [], agent]);
    }
  }

  const tokens: string[] = [];
  const agents: AgentDefinition[] = [];
  const seenAgents = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const token = match[1];
    if (!token) continue;
    const matches = aliases.get(token.toLocaleLowerCase()) ?? [];
    if (matches.length === 0) throw new Error(`未知 Agent mention: @${token}`);
    const uniqueMatches = [...new Map(matches.map((agent) => [agent.id, agent])).values()];
    if (uniqueMatches.length !== 1) throw new Error(`Agent mention 存在歧义: @${token}`);
    tokens.push(token);
    const agent = uniqueMatches[0];
    if (!agent || seenAgents.has(agent.id)) continue;
    seenAgents.add(agent.id);
    agents.push(agent);
  }
  return Object.freeze({ tokens: Object.freeze(tokens), agents: Object.freeze(agents) });
}

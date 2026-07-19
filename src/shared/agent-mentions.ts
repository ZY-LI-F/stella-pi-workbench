import type { AgentDefinition, KanbanTask, OrchestrationCatalog, ProjectAgentDefinition, Squad } from "./kanban";

const MENTION_PATTERN = /(?:^|\s)@([A-Za-z0-9_-]+)/gu;
const ACTIVE_MENTION_PATTERN = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u;

export interface ParsedAgentMentions {
  readonly tokens: readonly string[];
  readonly agents: readonly AgentDefinition[];
}

export interface AgentMentionQuery {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export interface InsertedAgentMention {
  readonly value: string;
  readonly caret: number;
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function aliasesFor(agents: readonly AgentDefinition[]): ReadonlyMap<string, readonly AgentDefinition[]> {
  const aliases = new Map<string, readonly AgentDefinition[]>();
  for (const agent of agents) {
    for (const alias of [agent.id, agent.callsign]) {
      const key = alias.toLocaleLowerCase();
      aliases.set(key, Object.freeze([...(aliases.get(key) ?? []), agent]));
    }
  }
  return aliases;
}

export function agentMentionQueryAtCaret(text: string, caret: number): AgentMentionQuery | undefined {
  if (!Number.isInteger(caret) || caret < 0 || caret > text.length) throw new Error("Agent mention 光标位置无效");
  const prefix = text.slice(0, caret);
  const match = ACTIVE_MENTION_PATTERN.exec(prefix);
  if (!match) return undefined;
  const start = prefix.lastIndexOf("@");
  if (start < 0) return undefined;
  return Object.freeze({ start, end: caret, query: match[1] ?? "" });
}

export function filterMentionAgents(agents: readonly AgentDefinition[], query: string): readonly AgentDefinition[] {
  const needle = normalized(query);
  if (!needle) return Object.freeze([...agents]);
  return Object.freeze(agents
    .map((agent, index) => {
      const callsign = agent.callsign.toLocaleLowerCase();
      const id = agent.id.toLocaleLowerCase();
      const name = agent.name.toLocaleLowerCase();
      const responsibility = agent.responsibility.toLocaleLowerCase();
      const score = callsign === needle || id === needle
        ? 0
        : callsign.startsWith(needle) || id.startsWith(needle)
          ? 1
          : name.includes(needle)
            ? 2
            : responsibility.includes(needle)
              ? 3
              : Number.POSITIVE_INFINITY;
      return Object.freeze({ agent, index, score });
    })
    .filter((candidate) => Number.isFinite(candidate.score))
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((candidate) => candidate.agent));
}

export function insertAgentMention(
  text: string,
  range: Pick<AgentMentionQuery, "start" | "end">,
  agent: AgentDefinition,
): InsertedAgentMention {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end > text.length) {
    throw new Error("Agent mention 替换范围无效");
  }
  const before = text.slice(0, range.start);
  const after = text.slice(range.end);
  const beforeSpace = before.length > 0 && !/\s$/u.test(before) ? " " : "";
  const afterSpace = after.length === 0 || /^[\p{L}\p{N}_@]/u.test(after) ? " " : "";
  const insertion = `${beforeSpace}@${agent.callsign}${afterSpace}`;
  const existingInlineSeparator = !afterSpace && /^[ \t]/u.test(after) ? 1 : 0;
  return Object.freeze({ value: `${before}${insertion}${after}`, caret: before.length + insertion.length + existingInlineSeparator });
}

export function mentionedAgentIds(text: string, availableAgents: readonly AgentDefinition[]): ReadonlySet<string> {
  const aliases = aliasesFor(availableAgents);
  const ids = new Set<string>();
  for (const match of text.matchAll(MENTION_PATTERN)) {
    const token = match[1];
    if (!token) continue;
    const matches = aliases.get(token.toLocaleLowerCase()) ?? [];
    const unique = [...new Map(matches.map((agent) => [agent.id, agent])).values()];
    if (unique.length === 1 && unique[0]) ids.add(unique[0].id);
  }
  return ids;
}

export function availableMentionAgentsForTask(
  task: Pick<KanbanTask, "executionTarget" | "projectPath">,
  catalog: Pick<OrchestrationCatalog, "agents">,
  squads: readonly Squad[],
): readonly AgentDefinition[] {
  const inProject = (agent: AgentDefinition): boolean => {
    const scoped = agent as Partial<ProjectAgentDefinition>;
    return scoped.projectPath === undefined || scoped.projectPath === task.projectPath;
  };
  const executionTarget = task.executionTarget;
  if (executionTarget.kind !== "squad") return Object.freeze(catalog.agents.filter(inProject));
  const squad = squads.find((candidate) => candidate.id === executionTarget.squadId);
  if (!squad) throw new Error(`找不到 Squad: ${executionTarget.squadId}`);
  const agent = (agentId: string): AgentDefinition => {
    const definition = catalog.agents.find((candidate) => candidate.id === agentId);
    if (!definition) throw new Error(`未知 Agent: ${agentId}`);
    return definition;
  };
  const squadAgents = [agent(squad.leaderAgentId), ...squad.memberAgentIds.map(agent)];
  if (squadAgents.some((definition) => !inProject(definition))) throw new Error(`Squad ${squad.id} 包含其他项目的自定义 Agent`);
  const lead = catalog.agents.find((definition) => definition.id === "lead");
  return Object.freeze([...(lead && inProject(lead) && !squadAgents.some((definition) => definition.id === lead.id) ? [lead] : []), ...squadAgents]);
}

export function parseAgentMentions(text: string, availableAgents: readonly AgentDefinition[]): ParsedAgentMentions {
  const aliases = aliasesFor(availableAgents);

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

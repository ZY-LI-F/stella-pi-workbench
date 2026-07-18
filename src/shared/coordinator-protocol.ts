import type { AgentDefinition } from "./kanban";

export type CoordinatorActionType = "delegate" | "request_revision" | "replan" | "complete" | "ask_human";

export interface CoordinatorDelegation {
  readonly agentId: string;
  readonly objective: string;
  readonly acceptanceCriteria: string;
}

export interface CoordinatorAction {
  readonly action: CoordinatorActionType;
  readonly summary: string;
  readonly delegations: readonly CoordinatorDelegation[];
  readonly question?: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} 必须是 JSON 对象`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} 必须是非空字符串`);
  return value.trim();
}

export function parseCoordinatorAction(output: string, availableAgents: readonly AgentDefinition[]): CoordinatorAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`LEAD 输出不是有效的 Coordinator JSON：${message}`);
  }
  const value = record(parsed, "Coordinator action");
  const allowedKeys = new Set(["action", "summary", "delegations", "question"]);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Coordinator action 包含未知字段: ${unknownKey}`);
  const action = requiredString(value.action, "Coordinator action.action") as CoordinatorActionType;
  if (!["delegate", "request_revision", "replan", "complete", "ask_human"].includes(action)) {
    throw new Error(`不支持的 Coordinator action: ${action}`);
  }
  const summary = requiredString(value.summary, "Coordinator action.summary");
  const rawDelegations = value.delegations ?? [];
  if (!Array.isArray(rawDelegations)) throw new Error("Coordinator action.delegations 必须是数组");
  const knownAgents = new Map(availableAgents.filter((agent) => agent.id !== "lead").map((agent) => [agent.id, agent]));
  const delegations = rawDelegations.map((candidate, index) => {
    const delegation = record(candidate, `Coordinator action.delegations[${index}]`);
    const keys = Object.keys(delegation);
    if (keys.some((key) => !["agentId", "objective", "acceptanceCriteria"].includes(key))) {
      throw new Error(`Coordinator action.delegations[${index}] 包含未知字段`);
    }
    const agentId = requiredString(delegation.agentId, `Coordinator action.delegations[${index}].agentId`);
    if (!knownAgents.has(agentId)) throw new Error(`Coordinator 委派了未知或不可用 Agent: ${agentId}`);
    return Object.freeze({
      agentId,
      objective: requiredString(delegation.objective, `Coordinator action.delegations[${index}].objective`),
      acceptanceCriteria: requiredString(delegation.acceptanceCriteria, `Coordinator action.delegations[${index}].acceptanceCriteria`),
    });
  });
  if (new Set(delegations.map((delegation) => delegation.agentId)).size !== delegations.length) {
    throw new Error("Coordinator action 不能在同一轮重复委派同一个 Agent");
  }
  const delegates = action === "delegate" || action === "request_revision" || action === "replan";
  if (delegates && delegations.length === 0) throw new Error(`${action} action 至少需要一个 delegation`);
  if (!delegates && delegations.length > 0) throw new Error(`${action} action 不能包含 delegations`);
  const question = value.question === undefined ? undefined : requiredString(value.question, "Coordinator action.question");
  if (action === "ask_human" && !question) throw new Error("ask_human action 必须包含 question");
  if (action !== "ask_human" && question) throw new Error(`${action} action 不能包含 question`);
  return Object.freeze({ action, summary, delegations: Object.freeze(delegations), question });
}

export function coordinatorActionMessage(action: CoordinatorAction): string {
  if (action.action === "ask_human") return `${action.summary}\n\n需要你的决定：${action.question}`;
  if (action.delegations.length === 0) return action.summary;
  const label = action.action === "request_revision" ? "修订委派" : action.action === "replan" ? "重新规划" : "委派计划";
  return [action.summary, "", `${label}：`, ...action.delegations.map((item) => `- @${item.agentId}：${item.objective}\n  验收：${item.acceptanceCriteria}`)].join("\n");
}

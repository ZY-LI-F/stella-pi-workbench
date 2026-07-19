import type { AgentDefinition } from "./kanban";

export interface RuntimeModelSelection {
  readonly provider: string;
  readonly model: string;
}

interface SessionModelIdentity {
  readonly provider: string;
  readonly id: string;
}

export function runtimeModelSelectionFromSession(
  model: SessionModelIdentity | undefined,
): RuntimeModelSelection | undefined {
  if (!model) return undefined;
  const provider = model.provider.trim();
  const modelId = model.id.trim();
  if (provider.length === 0 || modelId.length === 0) {
    throw new Error("Pi 当前模型缺少 provider 或 model id");
  }
  return Object.freeze({ provider, model: modelId });
}

export function resolveAgentRuntimeModel(
  agent: Pick<AgentDefinition, "provider" | "model">,
  globalSelection: RuntimeModelSelection | undefined,
): Readonly<{ readonly provider?: string; readonly model?: string }> {
  const hasAgentOverride = agent.provider !== undefined || agent.model !== undefined;
  if (hasAgentOverride) {
    return Object.freeze({ provider: agent.provider, model: agent.model });
  }
  if (!globalSelection) return Object.freeze({});
  return Object.freeze({ provider: globalSelection.provider, model: globalSelection.model });
}

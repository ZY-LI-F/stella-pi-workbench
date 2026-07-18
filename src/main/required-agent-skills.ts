import type { PiCommand, PiResponse } from "../shared/contracts";
import type { AgentDefinition } from "../shared/kanban";

interface SkillRuntime {
  send(command: PiCommand): Promise<PiResponse>;
}

interface RpcCommandsData {
  readonly commands: readonly unknown[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function responseData(response: PiResponse): RpcCommandsData {
  if (!response.success) throw new Error(response.error);
  if (!("data" in response)) throw new Error("Pi RPC 命令 get_commands 没有返回 data");
  const data = record(response.data);
  if (!Array.isArray(data?.commands)) throw new Error("Pi RPC 命令 get_commands 返回了无效的 commands");
  return { commands: data.commands };
}

function skillCommandName(skill: string): string {
  return `skill:${skill}`;
}

export function requiredSkillsPrompt(agent: AgentDefinition): string {
  const required = agent.requiredSkills ?? [];
  if (required.length === 0) return agent.instructions;
  return [
    agent.instructions,
    "",
    `本 Agent 的必需 Pi Skills：${required.map(skillCommandName).join("、")}。`,
    "开始分析前必须加载并遵循这些 Skill；若 Skill 指令要求保存原始证据或标注快照日期，必须实际执行。",
  ].join("\n");
}

export async function assertRequiredAgentSkills(runtime: SkillRuntime, agent: AgentDefinition): Promise<void> {
  const required = agent.requiredSkills ?? [];
  if (required.length === 0) return;
  if (agent.disableSkills) {
    throw new Error(`Agent ${agent.name} 配置了必需 Skills，但 disableSkills=true`);
  }

  const data = responseData(await runtime.send({ type: "get_commands" }));
  const available = new Set(data.commands.flatMap((command) => {
    const item = record(command);
    return item?.source === "skill" && typeof item.name === "string" ? [item.name] : [];
  }));
  const missing = required.filter((skill) => !available.has(skillCommandName(skill)));
  if (missing.length === 0) return;

  throw new Error(
    `Agent ${agent.name} 缺少必需 Pi Skills：${missing.join("、")}。`
    + "请把 Skill 安装到受信任项目的 .pi/skills，或用户目录 ~/.pi/agent/skills 后重试。",
  );
}

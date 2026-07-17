import type { AgentDefinition, OrchestrationCatalog, TeamDefinition, WorkflowDefinition } from "./kanban";

const READ_TOOLS = Object.freeze(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = Object.freeze(["read", "grep", "find", "ls", "bash", "edit", "write"]);
const VERIFY_TOOLS = Object.freeze(["read", "grep", "find", "ls", "bash"]);

function agent(definition: AgentDefinition): AgentDefinition {
  return Object.freeze({ ...definition, allowedTools: Object.freeze([...definition.allowedTools]) });
}

export const BUILTIN_AGENTS: readonly AgentDefinition[] = Object.freeze([
  agent({
    id: "scout",
    version: 1,
    name: "项目侦察员",
    callsign: "SCOUT",
    responsibility: "只读勘察代码、约束与影响范围，给后续角色提供可验证事实。",
    instructions: "你是项目侦察员。只调查，不修改文件。引用具体文件与符号，区分事实、推断和未知项，最终给出精炼的侦察报告。",
    workspaceAccess: "read",
    allowedTools: READ_TOOLS,
    thinking: "medium",
    disableExtensions: true,
    disableSkills: true,
    disablePromptTemplates: true,
  }),
  agent({
    id: "planner",
    version: 1,
    name: "方案规划师",
    callsign: "PLAN",
    responsibility: "把任务与侦察事实转化为可执行、可验证的实现方案。",
    instructions: "你是方案规划师。只读分析，不修改文件。方案必须覆盖数据模型、边界、交互、验证和失败暴露，并指明将改动的代码位置。",
    workspaceAccess: "read",
    allowedTools: READ_TOOLS,
    thinking: "high",
    disableExtensions: true,
    disableSkills: true,
    disablePromptTemplates: true,
  }),
  agent({
    id: "builder",
    version: 1,
    name: "实现工程师",
    callsign: "BUILD",
    responsibility: "依据已批准方案修改真实项目，并执行与改动相称的验证。",
    instructions: "你是实现工程师。按任务、验收标准和上游方案完成真实修改；保留用户已有改动，不伪造成功，不吞掉失败。完成后列出变更和实际验证结果。",
    workspaceAccess: "write",
    allowedTools: WRITE_TOOLS,
    thinking: "high",
    disableExtensions: true,
    disableSkills: true,
    disablePromptTemplates: true,
  }),
  agent({
    id: "tester",
    version: 1,
    name: "验证工程师",
    callsign: "VERIFY",
    responsibility: "运行自动化检查并定位失败，提供可复现的质量结论。",
    instructions: "你是验证工程师。检查实际变更并运行最相关的测试、类型检查或构建。不要修改实现来掩盖失败；报告命令、结果、覆盖范围和尚未验证的风险。",
    workspaceAccess: "write",
    allowedTools: VERIFY_TOOLS,
    thinking: "medium",
    disableExtensions: true,
    disableSkills: true,
    disablePromptTemplates: true,
  }),
  agent({
    id: "reviewer",
    version: 1,
    name: "代码审阅者",
    callsign: "REVIEW",
    responsibility: "独立核对正确性、回归风险、安全与验收标准。",
    instructions: "你是独立代码审阅者。只读审查，不修改文件。优先报告会导致错误、数据丢失、回归或安全问题的发现，并给出具体文件位置；明确说明没有发现的问题范围。",
    workspaceAccess: "read",
    allowedTools: READ_TOOLS,
    thinking: "high",
    disableExtensions: true,
    disableSkills: true,
    disablePromptTemplates: true,
  }),
]);

function team(definition: TeamDefinition): TeamDefinition {
  return Object.freeze({ ...definition, roles: Object.freeze(definition.roles.map((role) => Object.freeze({ ...role }))) });
}

export const BUILTIN_TEAMS: readonly TeamDefinition[] = Object.freeze([
  team({
    id: "delivery-squad",
    version: 1,
    name: "交付小队",
    summary: "从勘察、规划到实现、验证和独立审阅的完整交付团队。",
    roles: [
      { id: "discovery", label: "勘察", agentId: "scout" },
      { id: "planning", label: "规划", agentId: "planner" },
      { id: "implementation", label: "实现", agentId: "builder" },
      { id: "verification", label: "验证", agentId: "tester" },
      { id: "review", label: "审阅", agentId: "reviewer" },
    ],
  }),
  team({
    id: "repair-crew",
    version: 1,
    name: "故障修复组",
    summary: "围绕复现、诊断、修复和回归检查组织的固定角色组合。",
    roles: [
      { id: "reproduction", label: "复现", agentId: "scout" },
      { id: "diagnosis", label: "诊断", agentId: "planner" },
      { id: "fix", label: "修复", agentId: "builder" },
      { id: "regression", label: "回归", agentId: "tester" },
      { id: "review", label: "审阅", agentId: "reviewer" },
    ],
  }),
  team({
    id: "review-pair",
    version: 1,
    name: "审阅双人组",
    summary: "由上下文侦察与独立审阅组成，不写入项目。",
    roles: [
      { id: "context", label: "上下文", agentId: "scout" },
      { id: "review", label: "审阅", agentId: "reviewer" },
    ],
  }),
]);

function workflow(definition: WorkflowDefinition): WorkflowDefinition {
  return Object.freeze({ ...definition, steps: Object.freeze(definition.steps.map((step) => Object.freeze({ ...step }))) });
}

export const BUILTIN_WORKFLOWS: readonly WorkflowDefinition[] = Object.freeze([
  workflow({
    id: "feature-delivery",
    version: 1,
    name: "功能交付流程",
    shortName: "功能交付",
    summary: "先调查和设计，经人工确认后实现、验证、审阅并最终验收。",
    teamId: "delivery-squad",
    steps: [
      { kind: "agent", id: "discover", name: "项目勘察", summary: "理解现状与约束", agentId: "scout", objective: "调查完成此功能涉及的代码、现有约束、用户改动与验证入口。" },
      { kind: "agent", id: "plan", name: "实现方案", summary: "形成可执行计划", agentId: "planner", objective: "根据侦察产物设计具体实现方案，并逐条映射验收标准。" },
      { kind: "human-gate", id: "approve-plan", name: "方案确认", summary: "等待人工批准方案", instructions: "检查侦察结论和实现方案；批准后才允许写入项目。" },
      { kind: "agent", id: "build", name: "功能实现", summary: "修改真实项目", agentId: "builder", objective: "严格依据已批准方案完成实现，并执行必要的本地检查。" },
      { kind: "agent", id: "verify", name: "质量验证", summary: "运行自动化检查", agentId: "tester", objective: "验证真实变更是否满足任务与验收标准，完整暴露失败。" },
      { kind: "agent", id: "review", name: "独立审阅", summary: "核对风险与正确性", agentId: "reviewer", objective: "独立审查实现、测试结果与验收标准，报告可操作发现。" },
      { kind: "human-gate", id: "accept", name: "最终验收", summary: "等待人工验收交付", instructions: "查看实现、验证与审阅产物，明确批准或驳回本次交付。" },
    ],
  }),
  workflow({
    id: "bug-fix",
    version: 1,
    name: "缺陷修复流程",
    shortName: "缺陷修复",
    summary: "从复现和根因分析开始，完成修复、回归验证和独立审阅。",
    teamId: "repair-crew",
    steps: [
      { kind: "agent", id: "reproduce", name: "问题复现", summary: "收集失败证据", agentId: "scout", objective: "定位问题入口、相关代码与可复现证据，不修改文件。" },
      { kind: "agent", id: "diagnose", name: "根因诊断", summary: "形成修复策略", agentId: "planner", objective: "根据复现证据确认根因、影响面、修复方案和回归测试。" },
      { kind: "human-gate", id: "approve-fix", name: "修复确认", summary: "等待人工批准策略", instructions: "确认根因和修复边界后再允许写入项目。" },
      { kind: "agent", id: "fix", name: "实施修复", summary: "修复真实缺陷", agentId: "builder", objective: "实施已批准修复并补充能证明问题不会回归的检查。" },
      { kind: "agent", id: "regression", name: "回归验证", summary: "复验缺陷与相关路径", agentId: "tester", objective: "复验原始问题、运行相关回归检查并如实报告失败。" },
      { kind: "agent", id: "review", name: "修复审阅", summary: "独立检查修复质量", agentId: "reviewer", objective: "检查根因是否真正解决、修复是否引入新风险。" },
      { kind: "human-gate", id: "accept", name: "修复验收", summary: "等待人工验收", instructions: "核对复现、修复、回归和审阅产物后批准或驳回。" },
    ],
  }),
  workflow({
    id: "read-only-review",
    version: 1,
    name: "只读审阅流程",
    shortName: "代码审阅",
    summary: "不修改项目，用侦察事实支撑一次独立代码审阅。",
    teamId: "review-pair",
    steps: [
      { kind: "agent", id: "context", name: "审阅上下文", summary: "收集变更与约束", agentId: "scout", objective: "识别待审查范围、项目约束、现有改动和测试入口。" },
      { kind: "agent", id: "review", name: "独立审阅", summary: "形成审阅结论", agentId: "reviewer", objective: "基于上下文和任务要求审查正确性、风险与测试缺口。" },
      { kind: "human-gate", id: "accept", name: "审阅确认", summary: "等待人工确认结论", instructions: "查看审阅发现并明确确认或驳回。" },
    ],
  }),
]);

export const BUILTIN_ORCHESTRATION_CATALOG: OrchestrationCatalog = Object.freeze({
  agents: BUILTIN_AGENTS,
  teams: BUILTIN_TEAMS,
  workflows: BUILTIN_WORKFLOWS,
});

export function findWorkflow(workflowId: string): WorkflowDefinition {
  const workflow = BUILTIN_WORKFLOWS.find((candidate) => candidate.id === workflowId);
  if (!workflow) throw new Error(`未知流程模板: ${workflowId}`);
  return workflow;
}

export function agentsForWorkflow(definition: WorkflowDefinition): readonly AgentDefinition[] {
  const ids = new Set(definition.steps.filter((step) => step.kind === "agent").map((step) => step.agentId));
  return Object.freeze([...ids].map((id) => {
    const matchedAgent = BUILTIN_AGENTS.find((candidate) => candidate.id === id);
    if (!matchedAgent) throw new Error(`流程 ${definition.id} 引用了未知 Agent: ${id}`);
    return matchedAgent;
  }));
}

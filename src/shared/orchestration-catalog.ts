import type { AgentDefinition, BoardState, OrchestrationCatalog, TeamDefinition, WorkflowDefinition } from "./kanban";

const READ_TOOLS = Object.freeze(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = Object.freeze(["read", "grep", "find", "ls", "bash", "edit", "write"]);
const VERIFY_TOOLS = Object.freeze(["read", "grep", "find", "ls", "bash"]);

function agent(definition: AgentDefinition): AgentDefinition {
  return Object.freeze({
    ...definition,
    allowedTools: Object.freeze([...definition.allowedTools]),
    requiredSkills: definition.requiredSkills ? Object.freeze([...definition.requiredSkills]) : undefined,
  });
}

export const BUILTIN_AGENTS: readonly AgentDefinition[] = Object.freeze([
  agent({
    id: "lead",
    version: 1,
    name: "通用调度负责人",
    callsign: "LEAD",
    responsibility: "澄清目标、拆解工作、选择合适 Agent，并在成员报告后独立验收或要求修订。",
    instructions: "你是 Stella 的通用调度负责人。你不修改项目；所有委派、追问和完成判断必须通过 Stella Coordinator 的结构化行动协议表达，不得用自然语言 @mention 冒充已分发。",
    workspaceAccess: "read",
    allowedTools: READ_TOOLS,
    thinking: "high",
    disableExtensions: true,
    disableSkills: true,
    disablePromptTemplates: true,
  }),
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
  agent({
    id: "target-biologist",
    version: 1,
    name: "靶点生物学研究员",
    callsign: "BIO",
    responsibility: "标准化靶点身份，汇总人类疾病关联、组织/细胞表达和可成药证据，形成可追溯证据包。",
    instructions: "你是医药早研靶点生物学研究员。必须先遵循 target-evidence Skill；区分人类遗传、表达、机制、转化与推断证据，记录数据快照日期和原始来源。不得把相关性表述为因果性。",
    workspaceAccess: "write",
    allowedTools: VERIFY_TOOLS,
    requiredSkills: ["target-evidence"],
    thinking: "high",
    disableExtensions: true,
    disableSkills: false,
    disablePromptTemplates: true,
  }),
  agent({
    id: "clinical-intelligence",
    version: 1,
    name: "临床竞品分析师",
    callsign: "CLINICAL",
    responsibility: "按资产、申办方、适应症、阶段和状态核验临床竞争格局，并识别终止、拥挤度与差异化窗口。",
    instructions: "你是临床竞品分析师。必须先遵循 clinical-landscape Skill；ClinicalTrials.gov 状态优先于二手聚合站，申办方管线用于补充。对每条资产给出 NCT 编号、状态更新时间和来源，不得把公告中的计划当作已完成事实。",
    workspaceAccess: "write",
    allowedTools: VERIFY_TOOLS,
    requiredSkills: ["clinical-landscape"],
    thinking: "high",
    disableExtensions: true,
    disableSkills: false,
    disablePromptTemplates: true,
  }),
  agent({
    id: "target-strategist",
    version: 1,
    name: "靶点策略负责人",
    callsign: "STRATEGY",
    responsibility: "把生物学与竞品证据整合为带评分、假设、风险和下一步实验的早研决策报告。",
    instructions: "你是早研靶点评估负责人。必须遵循 target-assessment-report Skill，独立核对上游证据后输出决策级 Markdown；评分要能追溯到证据，不确定项不得用平均分掩盖。",
    workspaceAccess: "read",
    allowedTools: READ_TOOLS,
    requiredSkills: ["target-assessment-report"],
    thinking: "high",
    disableExtensions: true,
    disableSkills: false,
    disablePromptTemplates: true,
  }),
  agent({
    id: "evidence-auditor",
    version: 1,
    name: "证据审计员",
    callsign: "EVIDENCE",
    responsibility: "反向核对报告中的来源、时间、证据等级、竞争状态、评分计算和过度推断。",
    instructions: "你是独立证据审计员。必须遵循 target-assessment-report Skill；逐条核查可证伪事实、链接、时间戳和评分算术，优先指出会改变 Go/No-Go 结论的问题。不得为了给出结论而补造缺失证据。",
    workspaceAccess: "read",
    allowedTools: READ_TOOLS,
    requiredSkills: ["target-assessment-report"],
    thinking: "high",
    disableExtensions: true,
    disableSkills: false,
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
      { id: "coordination", label: "调度", agentId: "lead" },
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
  team({
    id: "early-target-squad",
    version: 1,
    name: "早研靶评小队",
    summary: "围绕靶点生物学、临床竞品、组合决策和独立证据审计组成的医药早研固定团队。",
    roles: [
      { id: "biology", label: "生物学证据", agentId: "target-biologist" },
      { id: "competition", label: "临床竞品", agentId: "clinical-intelligence" },
      { id: "strategy", label: "组合策略", agentId: "target-strategist" },
      { id: "audit", label: "证据审计", agentId: "evidence-auditor" },
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
  workflow({
    id: "early-target-assessment",
    version: 1,
    name: "早研靶点评估流程",
    shortName: "早研靶评",
    summary: "先建立靶点与临床竞争证据包，经人工确认范围后形成评分报告并完成独立证据审计。",
    teamId: "early-target-squad",
    steps: [
      { kind: "agent", id: "biology", name: "靶点证据", summary: "身份、疾病、表达与可成药性", agentId: "target-biologist", objective: "标准化目标基因/蛋白身份，采集 Open Targets、Human Protein Atlas 与 ChEMBL 证据，保存原始响应并形成带来源的生物学证据包。" },
      { kind: "agent", id: "competition", name: "竞品扫描", summary: "资产、试验、状态与差异化", agentId: "clinical-intelligence", objective: "检索靶点直接抑制剂的临床试验与申办方信息，按资产去重并报告阶段、状态、更新时间、终止原因和竞争空白。" },
      { kind: "human-gate", id: "scope-review", name: "证据范围确认", summary: "确认适应症、竞争边界与证据缺口", instructions: "检查靶点身份、证据快照日期、纳入/排除规则和临床资产去重结果；范围合理后再进入组合决策。" },
      { kind: "agent", id: "synthesis", name: "决策报告", summary: "评分、风险与实验建议", agentId: "target-strategist", objective: "整合已批准的上游证据，按统一评分卡输出靶点评估报告；包含结论、适应症假设、竞争定位、关键风险、证据缺口和可证伪的下一步实验。" },
      { kind: "agent", id: "audit", name: "证据审计", summary: "核对来源、日期、推断和评分", agentId: "evidence-auditor", objective: "对决策报告实施独立审计，列出通过项、会改变结论的问题和必要修订；明确最终结论是否得到当前证据支持。" },
      { kind: "human-gate", id: "accept", name: "组合评审", summary: "人工决定接受、驳回或补证", instructions: "核对报告与审计结果后，明确记录是否接受本次靶点评估及其适用边界。" },
    ],
  }),
]);

export const BUILTIN_ORCHESTRATION_CATALOG: OrchestrationCatalog = Object.freeze({
  agents: BUILTIN_AGENTS,
  teams: BUILTIN_TEAMS,
  workflows: BUILTIN_WORKFLOWS,
});

export function catalogForBoard(base: OrchestrationCatalog, board: Pick<BoardState, "customAgents">): OrchestrationCatalog {
  const agents = [...base.agents, ...board.customAgents];
  if (new Set(agents.map((agent) => agent.id.toLocaleLowerCase())).size !== agents.length) throw new Error("编排目录包含重复 Agent id");
  if (new Set(agents.map((agent) => agent.callsign.toLocaleLowerCase())).size !== agents.length) throw new Error("编排目录包含重复 Agent callsign");
  return Object.freeze({
    agents: Object.freeze(agents),
    teams: base.teams,
    workflows: base.workflows,
  });
}

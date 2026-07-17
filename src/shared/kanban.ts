export const BOARD_SCHEMA_VERSION = 1 as const;

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUSES = [
  "planned",
  "queued",
  "running",
  "review",
  "blocked",
  "failed",
  "interrupted",
  "completed",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const BOARD_LANES = ["planned", "queued", "running", "review", "blocked", "completed"] as const;
export type BoardLane = (typeof BOARD_LANES)[number];
export type ManualTaskStatus = "planned" | "blocked" | "completed";

export type WorkflowRunStatus = "queued" | "running" | "review" | "blocked" | "failed" | "interrupted" | "completed";
export type StepRunStatus = "pending" | "running" | "waiting" | "succeeded" | "failed" | "interrupted";
export type WorkspaceAccess = "read" | "write";
export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface AgentDefinition {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly callsign: string;
  readonly responsibility: string;
  readonly instructions: string;
  readonly workspaceAccess: WorkspaceAccess;
  readonly allowedTools: readonly string[];
  readonly thinking: AgentThinkingLevel;
  readonly provider?: string;
  readonly model?: string;
  readonly disableExtensions: boolean;
  readonly disableSkills: boolean;
  readonly disablePromptTemplates: boolean;
}

export interface TeamRole {
  readonly id: string;
  readonly label: string;
  readonly agentId: string;
}

export interface TeamDefinition {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly summary: string;
  readonly roles: readonly TeamRole[];
}

export interface AgentWorkflowStep {
  readonly kind: "agent";
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly agentId: string;
  readonly objective: string;
}

export interface HumanGateWorkflowStep {
  readonly kind: "human-gate";
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly instructions: string;
}

export type WorkflowStepDefinition = AgentWorkflowStep | HumanGateWorkflowStep;

export interface WorkflowDefinition {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly shortName: string;
  readonly summary: string;
  readonly teamId: string;
  readonly steps: readonly WorkflowStepDefinition[];
}

export interface KanbanTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
  readonly projectPath: string;
  readonly projectName: string;
  readonly trusted: boolean;
  readonly workflowId: string;
  readonly status: TaskStatus;
  readonly activeRunId?: string;
  readonly blockedReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentArtifact {
  readonly title: string;
  readonly content: string;
  readonly sessionPath?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
}

export interface StepRun {
  readonly id: string;
  readonly stepId: string;
  readonly stepKind: WorkflowStepDefinition["kind"];
  readonly name: string;
  readonly status: StepRunStatus;
  readonly agentId?: string;
  readonly sessionPath?: string;
  readonly artifact?: AgentArtifact;
  readonly error?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface WorkflowRun {
  readonly id: string;
  readonly taskId: string;
  readonly workflow: WorkflowDefinition;
  readonly agents: readonly AgentDefinition[];
  readonly status: WorkflowRunStatus;
  readonly currentStepId?: string;
  readonly steps: readonly StepRun[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export type ActivityKind =
  | "task"
  | "dispatch"
  | "status"
  | "agent"
  | "tool"
  | "artifact"
  | "gate"
  | "error";

export interface TaskActivity {
  readonly id: string;
  readonly taskId: string;
  readonly runId?: string;
  readonly stepId?: string;
  readonly kind: ActivityKind;
  readonly summary: string;
  readonly detail?: string;
  readonly createdAt: string;
}

export interface BoardState {
  readonly version: typeof BOARD_SCHEMA_VERSION;
  readonly tasks: readonly KanbanTask[];
  readonly runs: readonly WorkflowRun[];
  readonly activities: readonly TaskActivity[];
}

export interface OrchestrationCatalog {
  readonly agents: readonly AgentDefinition[];
  readonly teams: readonly TeamDefinition[];
  readonly workflows: readonly WorkflowDefinition[];
}

export interface BoardBootstrap {
  readonly board: BoardState;
  readonly catalog: OrchestrationCatalog;
}

export type BoardBridgeEvent =
  | { readonly type: "snapshot"; readonly bootstrap: BoardBootstrap }
  | {
      readonly type: "agent-event";
      readonly taskId: string;
      readonly runId: string;
      readonly stepId: string;
      readonly eventType: string;
      readonly toolName?: string;
      readonly message?: string;
    };

export interface CreateTaskInput {
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
  readonly projectPath: string;
  readonly projectName: string;
  readonly trusted: boolean;
  readonly workflowId: string;
}

export interface UpdateTaskInput {
  readonly taskId: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
  readonly workflowId: string;
}

export interface ResolveGateInput {
  readonly taskId: string;
  readonly decision: "approve" | "reject";
  readonly comment: string;
}

export const EMPTY_BOARD_STATE: BoardState = Object.freeze({
  version: BOARD_SCHEMA_VERSION,
  tasks: Object.freeze([]),
  runs: Object.freeze([]),
  activities: Object.freeze([]),
});

const MANUAL_STATUSES = new Set<TaskStatus>(["planned", "blocked", "completed"]);

export function boardLaneForStatus(status: TaskStatus): BoardLane {
  if (status === "failed" || status === "interrupted") return "blocked";
  return status;
}

export function canMoveTaskManually(task: KanbanTask, next: TaskStatus): next is ManualTaskStatus {
  return task.activeRunId === undefined && MANUAL_STATUSES.has(next);
}

export function workflowProgress(run: WorkflowRun | undefined): number {
  if (!run || run.steps.length === 0) return 0;
  const complete = run.steps.filter((step) => step.status === "succeeded").length;
  return Math.round((complete / run.steps.length) * 100);
}

export function activeStep(run: WorkflowRun | undefined): StepRun | undefined {
  if (!run?.currentStepId) return undefined;
  return run.steps.find((step) => step.stepId === run.currentStepId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, path: string, allowEmpty = false): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    throw new Error(`${path} 必须是${allowEmpty ? "" : "非空"}字符串`);
  }
}

function assertOptionalString(value: unknown, path: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") throw new Error(`${path} 必须是字符串`);
}

function assertIsoDate(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  if (Number.isNaN(Date.parse(value))) throw new Error(`${path} 不是有效日期`);
}

function assertOneOf<T extends string>(value: unknown, choices: readonly T[], path: string): asserts value is T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new Error(`${path} 的值 ${String(value)} 无效`);
  }
}

function assertWorkflowStep(value: unknown, path: string): asserts value is WorkflowStepDefinition {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertOneOf(value.kind, ["agent", "human-gate"] as const, `${path}.kind`);
  assertString(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`);
  assertString(value.summary, `${path}.summary`, true);
  if (value.kind === "agent") {
    assertString(value.agentId, `${path}.agentId`);
    assertString(value.objective, `${path}.objective`);
  } else {
    assertString(value.instructions, `${path}.instructions`);
  }
}

function assertWorkflow(value: unknown, path: string): asserts value is WorkflowDefinition {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) {
    throw new Error(`${path}.version 必须是正整数`);
  }
  assertString(value.name, `${path}.name`);
  assertString(value.shortName, `${path}.shortName`);
  assertString(value.summary, `${path}.summary`);
  assertString(value.teamId, `${path}.teamId`);
  if (!Array.isArray(value.steps) || value.steps.length === 0) throw new Error(`${path}.steps 不能为空`);
  value.steps.forEach((step, index) => assertWorkflowStep(step, `${path}.steps[${index}]`));
}

function assertAgent(value: unknown, path: string): asserts value is AgentDefinition {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  if (typeof value.version !== "number" || !Number.isInteger(value.version) || value.version < 1) {
    throw new Error(`${path}.version 必须是正整数`);
  }
  assertString(value.name, `${path}.name`);
  assertString(value.callsign, `${path}.callsign`);
  assertString(value.responsibility, `${path}.responsibility`);
  assertString(value.instructions, `${path}.instructions`);
  assertOneOf(value.workspaceAccess, ["read", "write"] as const, `${path}.workspaceAccess`);
  if (!Array.isArray(value.allowedTools) || !value.allowedTools.every((tool) => typeof tool === "string")) {
    throw new Error(`${path}.allowedTools 必须是字符串数组`);
  }
  assertOneOf(value.thinking, ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const, `${path}.thinking`);
  assertOptionalString(value.provider, `${path}.provider`);
  assertOptionalString(value.model, `${path}.model`);
  for (const key of ["disableExtensions", "disableSkills", "disablePromptTemplates"] as const) {
    if (typeof value[key] !== "boolean") throw new Error(`${path}.${key} 必须是布尔值`);
  }
}

function assertTask(value: unknown, path: string): asserts value is KanbanTask {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  for (const key of ["id", "title", "projectPath", "projectName", "workflowId"] as const) assertString(value[key], `${path}.${key}`);
  assertString(value.description, `${path}.description`, true);
  assertString(value.acceptanceCriteria, `${path}.acceptanceCriteria`, true);
  assertOneOf(value.priority, TASK_PRIORITIES, `${path}.priority`);
  assertOneOf(value.status, TASK_STATUSES, `${path}.status`);
  if (typeof value.trusted !== "boolean") throw new Error(`${path}.trusted 必须是布尔值`);
  assertOptionalString(value.activeRunId, `${path}.activeRunId`);
  assertOptionalString(value.blockedReason, `${path}.blockedReason`);
  assertIsoDate(value.createdAt, `${path}.createdAt`);
  assertIsoDate(value.updatedAt, `${path}.updatedAt`);
}

function assertArtifact(value: unknown, path: string): asserts value is AgentArtifact {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.title, `${path}.title`);
  assertString(value.content, `${path}.content`, true);
  assertOptionalString(value.sessionPath, `${path}.sessionPath`);
  for (const key of ["inputTokens", "outputTokens", "cost"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]))) {
      throw new Error(`${path}.${key} 必须是有限数字`);
    }
  }
}

function assertStepRun(value: unknown, path: string): asserts value is StepRun {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  for (const key of ["id", "stepId", "name"] as const) assertString(value[key], `${path}.${key}`);
  assertOneOf(value.stepKind, ["agent", "human-gate"] as const, `${path}.stepKind`);
  assertOneOf(value.status, ["pending", "running", "waiting", "succeeded", "failed", "interrupted"] as const, `${path}.status`);
  assertOptionalString(value.agentId, `${path}.agentId`);
  assertOptionalString(value.sessionPath, `${path}.sessionPath`);
  assertOptionalString(value.error, `${path}.error`);
  if (value.artifact !== undefined) assertArtifact(value.artifact, `${path}.artifact`);
  if (value.startedAt !== undefined) assertIsoDate(value.startedAt, `${path}.startedAt`);
  if (value.completedAt !== undefined) assertIsoDate(value.completedAt, `${path}.completedAt`);
}

function assertRun(value: unknown, path: string): asserts value is WorkflowRun {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.taskId, `${path}.taskId`);
  assertWorkflow(value.workflow, `${path}.workflow`);
  if (!Array.isArray(value.agents)) throw new Error(`${path}.agents 必须是数组`);
  value.agents.forEach((agent, index) => assertAgent(agent, `${path}.agents[${index}]`));
  assertOneOf(value.status, ["queued", "running", "review", "blocked", "failed", "interrupted", "completed"] as const, `${path}.status`);
  assertOptionalString(value.currentStepId, `${path}.currentStepId`);
  if (!Array.isArray(value.steps)) throw new Error(`${path}.steps 必须是数组`);
  value.steps.forEach((step, index) => assertStepRun(step, `${path}.steps[${index}]`));
  assertIsoDate(value.startedAt, `${path}.startedAt`);
  assertIsoDate(value.updatedAt, `${path}.updatedAt`);
  if (value.completedAt !== undefined) assertIsoDate(value.completedAt, `${path}.completedAt`);
}

function assertActivity(value: unknown, path: string): asserts value is TaskActivity {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.taskId, `${path}.taskId`);
  assertOptionalString(value.runId, `${path}.runId`);
  assertOptionalString(value.stepId, `${path}.stepId`);
  assertOneOf(value.kind, ["task", "dispatch", "status", "agent", "tool", "artifact", "gate", "error"] as const, `${path}.kind`);
  assertString(value.summary, `${path}.summary`);
  assertOptionalString(value.detail, `${path}.detail`);
  assertIsoDate(value.createdAt, `${path}.createdAt`);
}

export function parseBoardState(value: unknown): BoardState {
  if (!isRecord(value)) throw new Error("看板文件根节点必须是对象");
  if (value.version !== BOARD_SCHEMA_VERSION) throw new Error(`不支持的看板版本: ${String(value.version)}`);
  if (!Array.isArray(value.tasks) || !Array.isArray(value.runs) || !Array.isArray(value.activities)) {
    throw new Error("看板文件缺少 tasks、runs 或 activities 数组");
  }
  value.tasks.forEach((task, index) => assertTask(task, `tasks[${index}]`));
  value.runs.forEach((run, index) => assertRun(run, `runs[${index}]`));
  value.activities.forEach((activity, index) => assertActivity(activity, `activities[${index}]`));

  const tasks = value.tasks as unknown as readonly KanbanTask[];
  const runs = value.runs as unknown as readonly WorkflowRun[];
  const activities = value.activities as unknown as readonly TaskActivity[];
  const taskIds = new Set(tasks.map((task) => task.id));
  const runIds = new Set(runs.map((run) => run.id));
  const activityIds = new Set(activities.map((activity) => activity.id));
  if (taskIds.size !== tasks.length) throw new Error("看板文件包含重复任务 id");
  if (runIds.size !== runs.length) throw new Error("看板文件包含重复流程实例 id");
  if (activityIds.size !== activities.length) throw new Error("看板文件包含重复活动 id");

  const runsById = new Map(runs.map((run) => [run.id, run]));
  for (const task of tasks) {
    if (!task.activeRunId) continue;
    const activeRun = runsById.get(task.activeRunId);
    if (!activeRun || activeRun.taskId !== task.id) throw new Error(`任务 ${task.id} 的 activeRunId 无效`);
  }
  for (const run of runs) {
    if (!taskIds.has(run.taskId)) throw new Error(`流程实例 ${run.id} 引用了未知任务`);
    const stepIds = new Set(run.steps.map((step) => step.stepId));
    if (stepIds.size !== run.steps.length) throw new Error(`流程实例 ${run.id} 包含重复步骤`);
    const definitionIds = new Set(run.workflow.steps.map((step) => step.id));
    if (definitionIds.size !== run.workflow.steps.length || run.steps.some((step) => !definitionIds.has(step.stepId))) {
      throw new Error(`流程实例 ${run.id} 的步骤与流程快照不一致`);
    }
    if (run.currentStepId && !stepIds.has(run.currentStepId)) throw new Error(`流程实例 ${run.id} 的 currentStepId 无效`);
    const agentIds = new Set(run.agents.map((agent) => agent.id));
    if (agentIds.size !== run.agents.length) throw new Error(`流程实例 ${run.id} 包含重复 Agent`);
    if (run.workflow.steps.some((step) => step.kind === "agent" && !agentIds.has(step.agentId))) {
      throw new Error(`流程实例 ${run.id} 引用了未知 Agent`);
    }
  }
  for (const activity of activities) {
    if (!taskIds.has(activity.taskId)) throw new Error(`活动 ${activity.id} 引用了未知任务`);
    if (!activity.runId) continue;
    const run = runsById.get(activity.runId);
    if (!run || run.taskId !== activity.taskId) throw new Error(`活动 ${activity.id} 的 runId 无效`);
    if (activity.stepId && !run.steps.some((step) => step.stepId === activity.stepId)) {
      throw new Error(`活动 ${activity.id} 的 stepId 无效`);
    }
  }
  return Object.freeze({
    version: BOARD_SCHEMA_VERSION,
    tasks: Object.freeze(tasks.map((task) => Object.freeze({ ...task }))),
    runs: Object.freeze(runs.map((run) => Object.freeze({ ...run }))),
    activities: Object.freeze(activities.map((activity) => Object.freeze({ ...activity }))),
  });
}

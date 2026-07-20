export const BOARD_SCHEMA_VERSION = 4 as const;
export const BOARD_SCHEMA_V3 = 3 as const;
export const BOARD_SCHEMA_V2 = 2 as const;
export const LEGACY_BOARD_SCHEMA_VERSION = 1 as const;

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

const LEGACY_TASK_STATUSES = ["planned", "queued", "running", "review", "blocked", "failed", "interrupted", "completed"] as const;
type LegacyTaskStatus = (typeof LEGACY_TASK_STATUSES)[number];
const LEGACY_AGENT_TASK_STATUSES = ["queued", "running", "waiting_children", "succeeded", "failed", "interrupted", "cancelled"] as const;
type LegacyAgentTaskStatus = (typeof LEGACY_AGENT_TASK_STATUSES)[number];
const LEGACY_WORKFLOW_RUN_STATUSES = ["queued", "running", "review", "blocked", "failed", "interrupted", "completed"] as const;
type LegacyWorkflowRunStatus = (typeof LEGACY_WORKFLOW_RUN_STATUSES)[number];

export const TASK_STAGES = [
  "planned",
  "queued",
  "running",
  "review",
  "blocked",
  "completed",
] as const;
export type TaskStage = (typeof TASK_STAGES)[number];

export const AGENT_TASK_STATUSES = [
  "queued",
  "running",
  "waiting_children",
  "waiting_human",
  "reported",
  "failed",
  "interrupted",
  "cancelled",
] as const;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];
export const TERMINAL_AGENT_TASK_STATUSES = ["reported", "failed", "interrupted", "cancelled"] as const;

export type BoardLane = TaskStage;
export const MANUAL_TASK_STAGES = ["planned", "blocked", "completed"] as const satisfies readonly TaskStage[];
export type ManualTaskStage = (typeof MANUAL_TASK_STAGES)[number];

export const WORKFLOW_RUN_STATUSES = ["queued", "running", "review", "blocked", "failed", "interrupted", "reported"] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];
export const STEP_RUN_STATUSES = ["pending", "running", "waiting", "succeeded", "failed", "interrupted"] as const;
export type StepRunStatus = (typeof STEP_RUN_STATUSES)[number];
export const EXECUTION_ACCEPTANCE_STATUSES = ["not-ready", "pending", "accepted", "revision-requested", "rejected"] as const;
export type ExecutionAcceptanceStatus = (typeof EXECUTION_ACCEPTANCE_STATUSES)[number];
export type WorkspaceAccess = "read" | "write";
export const AGENT_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number];

export interface AgentDefinition {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly callsign: string;
  readonly responsibility: string;
  readonly instructions: string;
  readonly workspaceAccess: WorkspaceAccess;
  readonly allowedTools: readonly string[];
  /** Pi project/user skills that must be discoverable before this Agent receives a prompt. */
  readonly requiredSkills?: readonly string[];
  readonly thinking: AgentThinkingLevel;
  readonly provider?: string;
  readonly model?: string;
  readonly disableExtensions: boolean;
  readonly disableSkills: boolean;
  readonly disablePromptTemplates: boolean;
}

export interface ProjectAgentDefinition extends AgentDefinition {
  readonly projectPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
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

export type ExecutionTarget =
  | { readonly kind: "workflow"; readonly workflowId: string }
  | { readonly kind: "agent"; readonly agentId: string }
  | { readonly kind: "squad"; readonly squadId: string };

export interface KanbanTask {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
  readonly projectPath: string;
  readonly projectName: string;
  readonly trusted: boolean;
  readonly executionTarget: ExecutionTarget;
  readonly stage: TaskStage;
  readonly activeRunId?: string;
  readonly activeAgentTaskId?: string;
  readonly blockedReason?: string;
  readonly sourcePiSessionPath?: string;
  readonly sourcePiSessionId?: string;
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
  readonly acceptance: ExecutionAcceptanceStatus;
  readonly acceptanceComment?: string;
  readonly reviewedAt?: string;
  readonly currentStepId?: string;
  readonly steps: readonly StepRun[];
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
}

export const ACTIVITY_KINDS = [
  "task",
  "dispatch",
  "status",
  "agent",
  "tool",
  "artifact",
  "gate",
  "comment",
  "automation",
  "error",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface TaskActivity {
  readonly id: string;
  readonly taskId: string;
  readonly runId?: string;
  readonly stepId?: string;
  readonly agentTaskId?: string;
  readonly kind: ActivityKind;
  readonly summary: string;
  readonly detail?: string;
  readonly createdAt: string;
}

export const TASK_COMMENT_AUTHORS = ["user", "agent", "system"] as const;
export type TaskCommentAuthor = (typeof TASK_COMMENT_AUTHORS)[number];
export const TASK_MESSAGE_KINDS = ["comment", "execution-report", "acceptance"] as const;
export type TaskMessageKind = (typeof TASK_MESSAGE_KINDS)[number];

export interface TaskComment {
  readonly id: string;
  readonly taskId: string;
  readonly author: TaskCommentAuthor;
  readonly authorAgentId?: string;
  readonly messageKind?: TaskMessageKind;
  readonly runId?: string;
  readonly agentTaskId?: string;
  readonly body: string;
  readonly createdAt: string;
}

export const AGENT_TASK_KINDS = ["direct", "mention-root", "squad-leader", "coordinator", "coordinator-review", "delegated"] as const;
export type AgentTaskKind = (typeof AGENT_TASK_KINDS)[number];

export interface AgentTask {
  readonly id: string;
  readonly taskId: string;
  readonly agentSnapshot: AgentDefinition;
  readonly kind: AgentTaskKind;
  readonly status: AgentTaskStatus;
  readonly acceptance: ExecutionAcceptanceStatus;
  readonly acceptanceComment?: string;
  readonly reviewedAt?: string;
  readonly prompt: string;
  readonly parentAgentTaskId?: string;
  readonly squadId?: string;
  readonly runtimeToken?: string;
  readonly sessionPath?: string;
  readonly output?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export interface Squad {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly leaderAgentId: string;
  readonly memberAgentIds: readonly string[];
  readonly leaderInstructions: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AutopilotTaskTemplate {
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
}

export type AutopilotTrigger =
  | { readonly kind: "manual" }
  | { readonly kind: "schedule"; readonly intervalMinutes: number; readonly nextRunAt: string }
  | { readonly kind: "webhook"; readonly token: string };

export const AUTOPILOT_TRIGGER_KINDS = ["manual", "schedule", "webhook"] as const satisfies readonly AutopilotTrigger["kind"][];

export interface Autopilot {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: AutopilotTrigger;
  readonly taskTemplate: AutopilotTaskTemplate;
  readonly projectPath: string;
  readonly projectName: string;
  readonly trusted: boolean;
  readonly executionTarget: ExecutionTarget;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const AUTOPILOT_RUN_STATUSES = ["running", "succeeded", "failed", "missed"] as const;
export type AutopilotRunStatus = (typeof AUTOPILOT_RUN_STATUSES)[number];
export type JsonObject = Readonly<Record<string, unknown>>;

export interface AutopilotRun {
  readonly id: string;
  readonly autopilotId: string;
  readonly triggerKind: AutopilotTrigger["kind"];
  readonly status: AutopilotRunStatus;
  readonly taskId?: string;
  readonly requestPayload?: JsonObject;
  readonly error?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface BoardState {
  readonly version: typeof BOARD_SCHEMA_VERSION;
  readonly tasks: readonly KanbanTask[];
  readonly runs: readonly WorkflowRun[];
  readonly activities: readonly TaskActivity[];
  readonly comments: readonly TaskComment[];
  readonly agentTasks: readonly AgentTask[];
  readonly customAgents: readonly ProjectAgentDefinition[];
  readonly squads: readonly Squad[];
  readonly autopilots: readonly Autopilot[];
  readonly autopilotRuns: readonly AutopilotRun[];
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

export interface AutomationRuntimeStatus {
  readonly webhook: {
    readonly state: "stopped" | "listening" | "error";
    readonly host: "127.0.0.1";
    readonly port: number;
    readonly error?: string;
  };
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
    }
  | {
      readonly type: "agent-task-event";
      readonly taskId: string;
      readonly agentTaskId: string;
      readonly eventType: string;
      readonly toolName?: string;
      readonly message?: string;
    }
  | { readonly type: "automation-error"; readonly source: "agent-task-runner" | "workflow-orchestrator" | "schedule" | "webhook"; readonly message: string }
  | { readonly type: "automation-runtime"; readonly status: AutomationRuntimeStatus };

export interface CreateTaskInput {
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
  readonly projectPath: string;
  readonly projectName: string;
  readonly trusted: boolean;
  readonly executionTarget: ExecutionTarget;
  readonly sourcePiSessionPath?: string;
  readonly sourcePiSessionId?: string;
}

export interface UpdateTaskInput {
  readonly taskId: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
  readonly executionTarget: ExecutionTarget;
}

export interface CreateTaskCommentInput {
  readonly taskId: string;
  readonly body: string;
}

export interface LaunchTeamTaskInput {
  readonly body: string;
}

export interface CreateProjectAgentInput {
  readonly name: string;
  readonly callsign: string;
  readonly responsibility: string;
  readonly instructions: string;
  readonly workspaceAccess: WorkspaceAccess;
  readonly allowedTools: readonly string[];
  readonly requiredSkills?: readonly string[];
  readonly thinking: AgentThinkingLevel;
  readonly provider?: string;
  readonly model?: string;
  readonly disableExtensions: boolean;
  readonly disableSkills: boolean;
  readonly disablePromptTemplates: boolean;
  readonly projectPath: string;
}

export interface UpdateProjectAgentInput extends CreateProjectAgentInput {
  readonly agentId: string;
}

export interface CreateSquadInput {
  readonly name: string;
  readonly description: string;
  readonly leaderAgentId: string;
  readonly memberAgentIds: readonly string[];
  readonly leaderInstructions: string;
}

export interface UpdateSquadInput extends CreateSquadInput {
  readonly squadId: string;
}

export type CreateAutopilotTrigger =
  | { readonly kind: "manual" }
  | { readonly kind: "schedule"; readonly intervalMinutes: number; readonly nextRunAt: string }
  | { readonly kind: "webhook" };

export interface CreateAutopilotInput {
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: CreateAutopilotTrigger;
  readonly taskTemplate: AutopilotTaskTemplate;
  readonly projectPath: string;
  readonly projectName: string;
  readonly trusted: boolean;
  readonly executionTarget: ExecutionTarget;
}

export interface UpdateAutopilotInput extends Omit<CreateAutopilotInput, "trigger"> {
  readonly autopilotId: string;
  readonly trigger: AutopilotTrigger;
}

export interface ResolveGateInput {
  readonly taskId: string;
  readonly decision: "approve" | "reject";
  readonly comment: string;
}

export type ExecutionReviewDecision = "accept" | "revision-requested" | "reject";

export interface ReviewExecutionInput {
  readonly taskId: string;
  readonly executionKind: "workflow" | "agent-task";
  readonly executionId: string;
  readonly decision: ExecutionReviewDecision;
  readonly comment: string;
}

export interface OpenTaskSessionInput {
  readonly taskId: string;
  readonly sessionPath: string;
}

export const EMPTY_BOARD_STATE: BoardState = Object.freeze({
  version: BOARD_SCHEMA_VERSION,
  tasks: Object.freeze([]),
  runs: Object.freeze([]),
  activities: Object.freeze([]),
  comments: Object.freeze([]),
  agentTasks: Object.freeze([]),
  customAgents: Object.freeze([]),
  squads: Object.freeze([]),
  autopilots: Object.freeze([]),
  autopilotRuns: Object.freeze([]),
});

const MANUAL_STAGES = new Set<TaskStage>(MANUAL_TASK_STAGES);
const TERMINAL_AGENT_TASK_SET = new Set<AgentTaskStatus>(TERMINAL_AGENT_TASK_STATUSES);

export function canMoveTaskManually(task: KanbanTask, next: TaskStage): next is ManualTaskStage {
  return task.activeRunId === undefined && task.activeAgentTaskId === undefined && MANUAL_STAGES.has(next);
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

export function isTerminalAgentTaskStatus(status: AgentTaskStatus): boolean {
  return TERMINAL_AGENT_TASK_SET.has(status);
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

function assertOptionalIsoDate(value: unknown, path: string): asserts value is string | undefined {
  if (value !== undefined) assertIsoDate(value, path);
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`${path} 必须是正整数`);
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} 必须是有限数字`);
}

function assertOptionalFiniteNumber(value: unknown, path: string): asserts value is number | undefined {
  if (value !== undefined) assertFiniteNumber(value, path);
}

function assertOneOf<T extends string>(value: unknown, choices: readonly T[], path: string): asserts value is T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${path} 的值 ${String(value)} 无效`);
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim().length > 0)) {
    throw new Error(`${path} 必须是非空字符串数组`);
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
  assertPositiveInteger(value.version, `${path}.version`);
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
  assertPositiveInteger(value.version, `${path}.version`);
  assertString(value.name, `${path}.name`);
  assertString(value.callsign, `${path}.callsign`);
  if (!/^[A-Z0-9_-]+$/u.test(value.callsign)) throw new Error(`${path}.callsign 只能包含大写英文字母、数字、下划线或连字符`);
  assertString(value.responsibility, `${path}.responsibility`);
  assertString(value.instructions, `${path}.instructions`);
  assertOneOf(value.workspaceAccess, ["read", "write"] as const, `${path}.workspaceAccess`);
  assertStringArray(value.allowedTools, `${path}.allowedTools`);
  if (value.requiredSkills !== undefined) assertStringArray(value.requiredSkills, `${path}.requiredSkills`);
  assertOneOf(value.thinking, AGENT_THINKING_LEVELS, `${path}.thinking`);
  assertOptionalString(value.provider, `${path}.provider`);
  assertOptionalString(value.model, `${path}.model`);
  for (const key of ["disableExtensions", "disableSkills", "disablePromptTemplates"] as const) {
    if (typeof value[key] !== "boolean") throw new Error(`${path}.${key} 必须是布尔值`);
  }
}

function assertProjectAgent(value: unknown, path: string): asserts value is ProjectAgentDefinition {
  assertAgent(value, path);
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.projectPath, `${path}.projectPath`);
  assertIsoDate(value.createdAt, `${path}.createdAt`);
  assertIsoDate(value.updatedAt, `${path}.updatedAt`);
}

function assertExecutionTarget(value: unknown, path: string): asserts value is ExecutionTarget {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertOneOf(value.kind, ["workflow", "agent", "squad"] as const, `${path}.kind`);
  if (value.kind === "workflow") assertString(value.workflowId, `${path}.workflowId`);
  if (value.kind === "agent") assertString(value.agentId, `${path}.agentId`);
  if (value.kind === "squad") assertString(value.squadId, `${path}.squadId`);
}

function assertTaskBase(value: Record<string, unknown>, path: string): void {
  for (const key of ["id", "title", "projectPath", "projectName"] as const) assertString(value[key], `${path}.${key}`);
  assertString(value.description, `${path}.description`, true);
  assertString(value.acceptanceCriteria, `${path}.acceptanceCriteria`, true);
  assertOneOf(value.priority, TASK_PRIORITIES, `${path}.priority`);
  if (typeof value.trusted !== "boolean") throw new Error(`${path}.trusted 必须是布尔值`);
  assertOptionalString(value.activeRunId, `${path}.activeRunId`);
  assertOptionalString(value.activeAgentTaskId, `${path}.activeAgentTaskId`);
  assertOptionalString(value.blockedReason, `${path}.blockedReason`);
  assertOptionalString(value.sourcePiSessionPath, `${path}.sourcePiSessionPath`);
  assertOptionalString(value.sourcePiSessionId, `${path}.sourcePiSessionId`);
  assertIsoDate(value.createdAt, `${path}.createdAt`);
  assertIsoDate(value.updatedAt, `${path}.updatedAt`);
}

function assertTask(value: unknown, path: string): asserts value is KanbanTask {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertTaskBase(value, path);
  assertOneOf(value.stage, TASK_STAGES, `${path}.stage`);
  assertExecutionTarget(value.executionTarget, `${path}.executionTarget`);
  if (value.activeRunId !== undefined && value.activeAgentTaskId !== undefined) {
    throw new Error(`${path} 不能同时拥有 activeRunId 和 activeAgentTaskId`);
  }
}

function assertLegacyTask(value: unknown, path: string): asserts value is Record<string, unknown> & { readonly workflowId: string } {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertTaskBase(value, path);
  assertOneOf(value.status, LEGACY_TASK_STATUSES, `${path}.status`);
  assertString(value.workflowId, `${path}.workflowId`);
  if (value.activeAgentTaskId !== undefined) throw new Error(`${path}.activeAgentTaskId 不属于 schema v1`);
}

function assertArtifact(value: unknown, path: string): asserts value is AgentArtifact {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.title, `${path}.title`);
  assertString(value.content, `${path}.content`, true);
  assertOptionalString(value.sessionPath, `${path}.sessionPath`);
  for (const key of ["inputTokens", "outputTokens", "cost"] as const) assertOptionalFiniteNumber(value[key], `${path}.${key}`);
}

function assertStepRun(value: unknown, path: string): asserts value is StepRun {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  for (const key of ["id", "stepId", "name"] as const) assertString(value[key], `${path}.${key}`);
  assertOneOf(value.stepKind, ["agent", "human-gate"] as const, `${path}.stepKind`);
  assertOneOf(value.status, STEP_RUN_STATUSES, `${path}.status`);
  assertOptionalString(value.agentId, `${path}.agentId`);
  assertOptionalString(value.sessionPath, `${path}.sessionPath`);
  assertOptionalString(value.error, `${path}.error`);
  if (value.artifact !== undefined) assertArtifact(value.artifact, `${path}.artifact`);
  assertOptionalIsoDate(value.startedAt, `${path}.startedAt`);
  assertOptionalIsoDate(value.completedAt, `${path}.completedAt`);
}

function assertRun(value: unknown, path: string): asserts value is WorkflowRun {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.taskId, `${path}.taskId`);
  assertWorkflow(value.workflow, `${path}.workflow`);
  if (!Array.isArray(value.agents)) throw new Error(`${path}.agents 必须是数组`);
  value.agents.forEach((agent, index) => assertAgent(agent, `${path}.agents[${index}]`));
  assertOneOf(value.status, WORKFLOW_RUN_STATUSES, `${path}.status`);
  assertOneOf(value.acceptance, EXECUTION_ACCEPTANCE_STATUSES, `${path}.acceptance`);
  assertOptionalString(value.acceptanceComment, `${path}.acceptanceComment`);
  assertOptionalIsoDate(value.reviewedAt, `${path}.reviewedAt`);
  assertOptionalString(value.currentStepId, `${path}.currentStepId`);
  if (!Array.isArray(value.steps)) throw new Error(`${path}.steps 必须是数组`);
  value.steps.forEach((step, index) => assertStepRun(step, `${path}.steps[${index}]`));
  assertIsoDate(value.startedAt, `${path}.startedAt`);
  assertIsoDate(value.updatedAt, `${path}.updatedAt`);
  assertOptionalIsoDate(value.completedAt, `${path}.completedAt`);
  assertExecutionAcceptance(value, path);
}

function assertExecutionAcceptance(value: Record<string, unknown>, path: string): void {
  const status = value.status;
  const acceptance = value.acceptance;
  const reviewed = acceptance === "accepted" || acceptance === "revision-requested" || acceptance === "rejected";
  if (status !== "reported" && acceptance !== "not-ready") {
    throw new Error(`${path}.acceptance 只有 reported 执行可以进入验收`);
  }
  if (status === "reported" && acceptance !== "pending" && !reviewed) {
    throw new Error(`${path}.acceptance 必须等待或记录验收结论`);
  }
  if (reviewed && !value.reviewedAt) throw new Error(`${path}.reviewedAt 是验收结论的必填字段`);
  if (!reviewed && value.reviewedAt !== undefined) throw new Error(`${path}.reviewedAt 只允许已验收执行使用`);
  if (!reviewed && value.acceptanceComment !== undefined) throw new Error(`${path}.acceptanceComment 只允许已验收执行使用`);
  if ((acceptance === "revision-requested" || acceptance === "rejected") && !value.acceptanceComment) {
    throw new Error(`${path}.acceptanceComment 是修订或拒绝的必填字段`);
  }
}

function assertActivity(value: unknown, path: string): asserts value is TaskActivity {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.taskId, `${path}.taskId`);
  assertOptionalString(value.runId, `${path}.runId`);
  assertOptionalString(value.stepId, `${path}.stepId`);
  assertOptionalString(value.agentTaskId, `${path}.agentTaskId`);
  assertOneOf(value.kind, ACTIVITY_KINDS, `${path}.kind`);
  assertString(value.summary, `${path}.summary`);
  assertOptionalString(value.detail, `${path}.detail`);
  assertIsoDate(value.createdAt, `${path}.createdAt`);
}

function assertComment(value: unknown, path: string): asserts value is TaskComment {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.taskId, `${path}.taskId`);
  assertOneOf(value.author, TASK_COMMENT_AUTHORS, `${path}.author`);
  assertOptionalString(value.authorAgentId, `${path}.authorAgentId`);
  if (value.messageKind !== undefined) assertOneOf(value.messageKind, TASK_MESSAGE_KINDS, `${path}.messageKind`);
  assertOptionalString(value.runId, `${path}.runId`);
  assertOptionalString(value.agentTaskId, `${path}.agentTaskId`);
  assertString(value.body, `${path}.body`);
  assertIsoDate(value.createdAt, `${path}.createdAt`);
  if (value.author === "agent" && !value.authorAgentId) throw new Error(`${path}.authorAgentId 是 Agent 评论的必填字段`);
  if (value.author !== "agent" && value.authorAgentId !== undefined) throw new Error(`${path}.authorAgentId 只允许 Agent 评论使用`);
}

function assertAgentTask(value: unknown, path: string): asserts value is AgentTask {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.taskId, `${path}.taskId`);
  assertAgent(value.agentSnapshot, `${path}.agentSnapshot`);
  assertOneOf(value.kind, AGENT_TASK_KINDS, `${path}.kind`);
  assertOneOf(value.status, AGENT_TASK_STATUSES, `${path}.status`);
  assertOneOf(value.acceptance, EXECUTION_ACCEPTANCE_STATUSES, `${path}.acceptance`);
  assertOptionalString(value.acceptanceComment, `${path}.acceptanceComment`);
  assertOptionalIsoDate(value.reviewedAt, `${path}.reviewedAt`);
  assertString(value.prompt, `${path}.prompt`);
  assertOptionalString(value.parentAgentTaskId, `${path}.parentAgentTaskId`);
  assertOptionalString(value.squadId, `${path}.squadId`);
  assertOptionalString(value.runtimeToken, `${path}.runtimeToken`);
  assertOptionalString(value.sessionPath, `${path}.sessionPath`);
  assertOptionalString(value.output, `${path}.output`);
  assertOptionalString(value.error, `${path}.error`);
  for (const key of ["inputTokens", "outputTokens", "cost"] as const) assertOptionalFiniteNumber(value[key], `${path}.${key}`);
  assertIsoDate(value.createdAt, `${path}.createdAt`);
  assertIsoDate(value.updatedAt, `${path}.updatedAt`);
  assertOptionalIsoDate(value.startedAt, `${path}.startedAt`);
  assertOptionalIsoDate(value.completedAt, `${path}.completedAt`);
  if (value.status === "running" && !value.runtimeToken) throw new Error(`${path}.runtimeToken 是 running 状态的必填字段`);
  if (value.status !== "running" && value.runtimeToken !== undefined) throw new Error(`${path}.runtimeToken 只允许 running 状态使用`);
  if (TERMINAL_AGENT_TASK_SET.has(value.status) && !value.completedAt) throw new Error(`${path}.completedAt 是终态的必填字段`);
  if (value.status === "waiting_children" && value.kind !== "squad-leader" && value.kind !== "mention-root" && value.kind !== "coordinator") {
    throw new Error(`${path} 只有 Squad Leader、mention root 或 Coordinator 能等待子任务`);
  }
  if (value.status === "waiting_human" && value.kind !== "coordinator") throw new Error(`${path} 只有 Coordinator 能等待用户回复`);
  if (value.kind === "delegated" && !value.parentAgentTaskId) throw new Error(`${path}.parentAgentTaskId 是 delegated 任务的必填字段`);
  if (value.kind === "coordinator-review" && !value.parentAgentTaskId) throw new Error(`${path}.parentAgentTaskId 是 coordinator-review 的必填字段`);
  if (value.kind === "squad-leader" && !value.squadId) throw new Error(`${path}.squadId 是 Squad Leader 的必填字段`);
  const isRoot = value.parentAgentTaskId === undefined;
  if (!isRoot && value.acceptance !== "not-ready") throw new Error(`${path}.acceptance 只允许根 AgentTask 使用`);
  if (isRoot) assertExecutionAcceptance(value, path);
}

function assertSquad(value: unknown, path: string): asserts value is Squad {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`);
  assertString(value.description, `${path}.description`, true);
  assertString(value.leaderAgentId, `${path}.leaderAgentId`);
  assertStringArray(value.memberAgentIds, `${path}.memberAgentIds`);
  assertString(value.leaderInstructions, `${path}.leaderInstructions`);
  assertIsoDate(value.createdAt, `${path}.createdAt`);
  assertIsoDate(value.updatedAt, `${path}.updatedAt`);
  if (new Set(value.memberAgentIds).size !== value.memberAgentIds.length) throw new Error(`${path}.memberAgentIds 包含重复 Agent`);
  if (value.memberAgentIds.includes(value.leaderAgentId)) throw new Error(`${path} 的 Leader 不能重复出现在成员中`);
}

function assertTaskTemplate(value: unknown, path: string): asserts value is AutopilotTaskTemplate {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.title, `${path}.title`);
  assertString(value.description, `${path}.description`, true);
  assertString(value.acceptanceCriteria, `${path}.acceptanceCriteria`, true);
  assertOneOf(value.priority, TASK_PRIORITIES, `${path}.priority`);
}

function assertAutopilotTrigger(value: unknown, path: string): asserts value is AutopilotTrigger {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertOneOf(value.kind, AUTOPILOT_TRIGGER_KINDS, `${path}.kind`);
  if (value.kind === "schedule") {
    assertPositiveInteger(value.intervalMinutes, `${path}.intervalMinutes`);
    assertIsoDate(value.nextRunAt, `${path}.nextRunAt`);
  }
  if (value.kind === "webhook") assertString(value.token, `${path}.token`);
}

function assertAutopilot(value: unknown, path: string): asserts value is Autopilot {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.name, `${path}.name`);
  if (typeof value.enabled !== "boolean") throw new Error(`${path}.enabled 必须是布尔值`);
  assertAutopilotTrigger(value.trigger, `${path}.trigger`);
  assertTaskTemplate(value.taskTemplate, `${path}.taskTemplate`);
  assertString(value.projectPath, `${path}.projectPath`);
  assertString(value.projectName, `${path}.projectName`);
  if (typeof value.trusted !== "boolean") throw new Error(`${path}.trusted 必须是布尔值`);
  assertExecutionTarget(value.executionTarget, `${path}.executionTarget`);
  assertIsoDate(value.createdAt, `${path}.createdAt`);
  assertIsoDate(value.updatedAt, `${path}.updatedAt`);
}

function assertJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} 包含非有限数字`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => assertJsonValue(item, `${path}.${key}`));
    return;
  }
  throw new Error(`${path} 不是可序列化 JSON 值`);
}

function assertAutopilotRun(value: unknown, path: string): asserts value is AutopilotRun {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertString(value.id, `${path}.id`);
  assertString(value.autopilotId, `${path}.autopilotId`);
  assertOneOf(value.triggerKind, AUTOPILOT_TRIGGER_KINDS, `${path}.triggerKind`);
  assertOneOf(value.status, AUTOPILOT_RUN_STATUSES, `${path}.status`);
  assertOptionalString(value.taskId, `${path}.taskId`);
  assertOptionalString(value.error, `${path}.error`);
  if (value.requestPayload !== undefined) {
    if (!isRecord(value.requestPayload)) throw new Error(`${path}.requestPayload 必须是对象`);
    assertJsonValue(value.requestPayload, `${path}.requestPayload`);
  }
  assertIsoDate(value.startedAt, `${path}.startedAt`);
  assertOptionalIsoDate(value.completedAt, `${path}.completedAt`);
  if (value.status !== "running" && !value.completedAt) throw new Error(`${path}.completedAt 是终态的必填字段`);
  if (value.status === "running" && value.completedAt !== undefined) throw new Error(`${path}.completedAt 不允许用于 running 状态`);
}

function assertUniqueIds(values: readonly { readonly id: string }[], label: string): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) throw new Error(`看板文件包含重复${label} id`);
}

function cloneAgent(agent: AgentDefinition): AgentDefinition {
  return Object.freeze({
    ...agent,
    allowedTools: Object.freeze([...agent.allowedTools]),
    requiredSkills: agent.requiredSkills ? Object.freeze([...agent.requiredSkills]) : undefined,
  });
}

function cloneWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return Object.freeze({ ...workflow, steps: Object.freeze(workflow.steps.map((step) => Object.freeze({ ...step }))) });
}

function cloneRun(run: WorkflowRun): WorkflowRun {
  return Object.freeze({
    ...run,
    workflow: cloneWorkflow(run.workflow),
    agents: Object.freeze(run.agents.map(cloneAgent)),
    steps: Object.freeze(run.steps.map((step) => Object.freeze({
      ...step,
      artifact: step.artifact ? Object.freeze({ ...step.artifact }) : undefined,
    }))),
  });
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneJsonValue));
  if (isRecord(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)])));
  return value;
}

function validateReferences(state: BoardState): void {
  const taskIds = new Set(state.tasks.map((task) => task.id));
  const runsById = new Map(state.runs.map((run) => [run.id, run]));
  const agentTasksById = new Map(state.agentTasks.map((task) => [task.id, task]));
  const squadIds = new Set(state.squads.map((squad) => squad.id));

  for (const task of state.tasks) {
    if (task.executionTarget.kind === "squad" && !squadIds.has(task.executionTarget.squadId)) {
      throw new Error(`任务 ${task.id} 引用了未知 Squad`);
    }
    if (task.activeRunId) {
      const activeRun = runsById.get(task.activeRunId);
      if (!activeRun || activeRun.taskId !== task.id) throw new Error(`任务 ${task.id} 的 activeRunId 无效`);
    }
    if (task.activeAgentTaskId) {
      const activeAgentTask = agentTasksById.get(task.activeAgentTaskId);
      if (!activeAgentTask || activeAgentTask.taskId !== task.id || activeAgentTask.parentAgentTaskId) {
        throw new Error(`任务 ${task.id} 的 activeAgentTaskId 无效`);
      }
      if (isTerminalAgentTaskStatus(activeAgentTask.status)) throw new Error(`任务 ${task.id} 引用了终态 AgentTask`);
    }
  }

  for (const run of state.runs) {
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

  for (const activity of state.activities) {
    if (!taskIds.has(activity.taskId)) throw new Error(`活动 ${activity.id} 引用了未知任务`);
    if (activity.runId) {
      const run = runsById.get(activity.runId);
      if (!run || run.taskId !== activity.taskId) throw new Error(`活动 ${activity.id} 的 runId 无效`);
      if (activity.stepId && !run.steps.some((step) => step.stepId === activity.stepId)) {
        throw new Error(`活动 ${activity.id} 的 stepId 无效`);
      }
    }
    if (activity.agentTaskId) {
      const agentTask = agentTasksById.get(activity.agentTaskId);
      if (!agentTask || agentTask.taskId !== activity.taskId) throw new Error(`活动 ${activity.id} 的 agentTaskId 无效`);
    }
  }

  for (const comment of state.comments) {
    if (!taskIds.has(comment.taskId)) throw new Error(`评论 ${comment.id} 引用了未知任务`);
    if (comment.runId) {
      const run = runsById.get(comment.runId);
      if (!run || run.taskId !== comment.taskId) throw new Error(`消息 ${comment.id} 的 runId 无效`);
    }
    if (comment.agentTaskId) {
      const agentTask = agentTasksById.get(comment.agentTaskId);
      if (!agentTask || agentTask.taskId !== comment.taskId) throw new Error(`消息 ${comment.id} 的 agentTaskId 无效`);
    }
  }

  for (const agentTask of state.agentTasks) {
    if (!taskIds.has(agentTask.taskId)) throw new Error(`AgentTask ${agentTask.id} 引用了未知任务`);
    if (agentTask.squadId && !squadIds.has(agentTask.squadId)) throw new Error(`AgentTask ${agentTask.id} 引用了未知 Squad`);
    if (agentTask.parentAgentTaskId) {
      const parent = agentTasksById.get(agentTask.parentAgentTaskId);
      if (!parent || parent.taskId !== agentTask.taskId || (parent.kind !== "squad-leader" && parent.kind !== "mention-root" && parent.kind !== "coordinator")) {
        throw new Error(`AgentTask ${agentTask.id} 的 parentAgentTaskId 无效`);
      }
    }
    if (agentTask.status === "waiting_children" && !state.agentTasks.some((candidate) => candidate.parentAgentTaskId === agentTask.id)) {
      throw new Error(`AgentTask ${agentTask.id} 等待不存在的子任务`);
    }
    const visited = new Set<string>([agentTask.id]);
    let parentId = agentTask.parentAgentTaskId;
    while (parentId) {
      if (visited.has(parentId)) throw new Error(`AgentTask ${agentTask.id} 存在循环父子关系`);
      visited.add(parentId);
      parentId = agentTasksById.get(parentId)?.parentAgentTaskId;
    }
  }

  for (const autopilot of state.autopilots) {
    if (autopilot.executionTarget.kind === "squad" && !squadIds.has(autopilot.executionTarget.squadId)) {
      throw new Error(`Autopilot ${autopilot.id} 引用了未知 Squad`);
    }
  }
}

export function parseBoardState(value: unknown): BoardState {
  if (!isRecord(value)) throw new Error("看板文件根节点必须是对象");
  if (value.version !== BOARD_SCHEMA_VERSION) throw new Error(`不支持的看板版本: ${String(value.version)}`);
  const collections = ["tasks", "runs", "activities", "comments", "agentTasks", "customAgents", "squads", "autopilots", "autopilotRuns"] as const;
  for (const collection of collections) {
    if (!Array.isArray(value[collection])) throw new Error(`看板文件缺少 ${collection} 数组`);
  }

  const rawTasks = value.tasks as unknown[];
  const rawRuns = value.runs as unknown[];
  const rawActivities = value.activities as unknown[];
  const rawComments = value.comments as unknown[];
  const rawAgentTasks = value.agentTasks as unknown[];
  const rawCustomAgents = value.customAgents as unknown[];
  const rawSquads = value.squads as unknown[];
  const rawAutopilots = value.autopilots as unknown[];
  const rawAutopilotRuns = value.autopilotRuns as unknown[];
  rawTasks.forEach((task, index) => assertTask(task, `tasks[${index}]`));
  rawRuns.forEach((run, index) => assertRun(run, `runs[${index}]`));
  rawActivities.forEach((activity, index) => assertActivity(activity, `activities[${index}]`));
  rawComments.forEach((comment, index) => assertComment(comment, `comments[${index}]`));
  rawAgentTasks.forEach((agentTask, index) => assertAgentTask(agentTask, `agentTasks[${index}]`));
  rawCustomAgents.forEach((agent, index) => assertProjectAgent(agent, `customAgents[${index}]`));
  rawSquads.forEach((squad, index) => assertSquad(squad, `squads[${index}]`));
  rawAutopilots.forEach((autopilot, index) => assertAutopilot(autopilot, `autopilots[${index}]`));
  rawAutopilotRuns.forEach((run, index) => assertAutopilotRun(run, `autopilotRuns[${index}]`));

  const tasks = rawTasks as unknown as readonly KanbanTask[];
  const runs = rawRuns as unknown as readonly WorkflowRun[];
  const activities = rawActivities as unknown as readonly TaskActivity[];
  const comments = rawComments as unknown as readonly TaskComment[];
  const agentTasks = rawAgentTasks as unknown as readonly AgentTask[];
  const customAgents = rawCustomAgents as unknown as readonly ProjectAgentDefinition[];
  const squads = rawSquads as unknown as readonly Squad[];
  const autopilots = rawAutopilots as unknown as readonly Autopilot[];
  const autopilotRuns = rawAutopilotRuns as unknown as readonly AutopilotRun[];

  assertUniqueIds(tasks, "任务");
  assertUniqueIds(runs, "流程实例");
  assertUniqueIds(activities, "活动");
  assertUniqueIds(comments, "评论");
  assertUniqueIds(agentTasks, " AgentTask");
  assertUniqueIds(customAgents, "自定义 Agent");
  assertUniqueIds(squads, " Squad");
  assertUniqueIds(autopilots, " Autopilot");
  assertUniqueIds(autopilotRuns, " AutopilotRun");

  const state: BoardState = Object.freeze({
    version: BOARD_SCHEMA_VERSION,
    tasks: Object.freeze(tasks.map((task) => Object.freeze({ ...task, executionTarget: Object.freeze({ ...task.executionTarget }) }))),
    runs: Object.freeze(runs.map(cloneRun)),
    activities: Object.freeze(activities.map((activity) => Object.freeze({ ...activity }))),
    comments: Object.freeze(comments.map((comment) => Object.freeze({ ...comment }))),
    agentTasks: Object.freeze(agentTasks.map((agentTask) => Object.freeze({ ...agentTask, agentSnapshot: cloneAgent(agentTask.agentSnapshot) }))),
    customAgents: Object.freeze(customAgents.map((agent) => Object.freeze({ ...cloneAgent(agent), projectPath: agent.projectPath, createdAt: agent.createdAt, updatedAt: agent.updatedAt }))),
    squads: Object.freeze(squads.map((squad) => Object.freeze({ ...squad, memberAgentIds: Object.freeze([...squad.memberAgentIds]) }))),
    autopilots: Object.freeze(autopilots.map((autopilot) => Object.freeze({
      ...autopilot,
      trigger: Object.freeze({ ...autopilot.trigger }),
      taskTemplate: Object.freeze({ ...autopilot.taskTemplate }),
      executionTarget: Object.freeze({ ...autopilot.executionTarget }),
    }))),
    autopilotRuns: Object.freeze(autopilotRuns.map((run) => Object.freeze({
      ...run,
      requestPayload: run.requestPayload ? cloneJsonValue(run.requestPayload) as JsonObject : undefined,
    }))),
  });
  validateReferences(state);
  return state;
}

function stageFromLegacyStatus(status: LegacyTaskStatus): TaskStage {
  if (status === "failed" || status === "interrupted") return "blocked";
  return status;
}

function migrateV2Run(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertOneOf(value.status, LEGACY_WORKFLOW_RUN_STATUSES, `${path}.status`);
  const status = value.status as LegacyWorkflowRunStatus;
  return {
    ...value,
    status: status === "completed" ? "reported" : status,
    acceptance: status === "completed" ? "pending" : "not-ready",
  };
}

function migrateV2AgentTask(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象`);
  assertOneOf(value.status, LEGACY_AGENT_TASK_STATUSES, `${path}.status`);
  const status = value.status as LegacyAgentTaskStatus;
  const root = value.parentAgentTaskId === undefined;
  return {
    ...value,
    status: status === "succeeded" ? "reported" : status,
    acceptance: status === "succeeded" && root ? "pending" : "not-ready",
  };
}

export function migrateBoardStateV2(value: unknown): BoardState {
  if (!isRecord(value)) throw new Error("schema v2 看板文件根节点必须是对象");
  if (value.version !== BOARD_SCHEMA_V2) throw new Error(`无法从版本 ${String(value.version)} 迁移看板`);
  const collections = ["tasks", "runs", "activities", "comments", "agentTasks", "squads", "autopilots", "autopilotRuns"] as const;
  for (const collection of collections) {
    if (!Array.isArray(value[collection])) throw new Error(`schema v2 看板文件缺少 ${collection} 数组`);
  }

  const tasks = (value.tasks as unknown[]).map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error(`tasks[${index}] 必须是对象`);
    assertTaskBase(candidate, `tasks[${index}]`);
    assertOneOf(candidate.status, LEGACY_TASK_STATUSES, `tasks[${index}].status`);
    assertExecutionTarget(candidate.executionTarget, `tasks[${index}].executionTarget`);
    const { status, ...task } = candidate;
    return { ...task, stage: stageFromLegacyStatus(status as LegacyTaskStatus) };
  });

  return parseBoardState({
    version: BOARD_SCHEMA_VERSION,
    tasks,
    runs: (value.runs as unknown[]).map((run, index) => migrateV2Run(run, `runs[${index}]`)),
    activities: value.activities,
    comments: value.comments,
    agentTasks: (value.agentTasks as unknown[]).map((task, index) => migrateV2AgentTask(task, `agentTasks[${index}]`)),
    customAgents: [],
    squads: value.squads,
    autopilots: value.autopilots,
    autopilotRuns: value.autopilotRuns,
  });
}

export function migrateBoardStateV1(value: unknown): BoardState {
  if (!isRecord(value)) throw new Error("schema v1 看板文件根节点必须是对象");
  if (value.version !== LEGACY_BOARD_SCHEMA_VERSION) throw new Error(`无法从版本 ${String(value.version)} 迁移看板`);
  if (!Array.isArray(value.tasks) || !Array.isArray(value.runs) || !Array.isArray(value.activities)) {
    throw new Error("schema v1 看板文件缺少 tasks、runs 或 activities 数组");
  }
  value.tasks.forEach((task, index) => assertLegacyTask(task, `tasks[${index}]`));
  value.activities.forEach((activity, index) => assertActivity(activity, `activities[${index}]`));

  const migratedTasks = value.tasks.map((legacy) => {
    const task = legacy as Record<string, unknown> & { readonly workflowId: string };
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria,
      priority: task.priority,
      projectPath: task.projectPath,
      projectName: task.projectName,
      trusted: task.trusted,
      executionTarget: { kind: "workflow", workflowId: task.workflowId },
      stage: stageFromLegacyStatus(task.status as LegacyTaskStatus),
      activeRunId: task.activeRunId,
      blockedReason: task.blockedReason,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  });

  return parseBoardState({
    version: BOARD_SCHEMA_VERSION,
    tasks: migratedTasks,
    runs: value.runs.map((run, index) => migrateV2Run(run, `runs[${index}]`)),
    activities: value.activities,
    comments: [],
    agentTasks: [],
    customAgents: [],
    squads: [],
    autopilots: [],
    autopilotRuns: [],
  });
}

export function migrateBoardStateV3(value: unknown): BoardState {
  if (!isRecord(value)) throw new Error("schema v3 看板文件根节点必须是对象");
  if (value.version !== BOARD_SCHEMA_V3) throw new Error(`无法从版本 ${String(value.version)} 迁移看板`);
  const collections = ["tasks", "runs", "activities", "comments", "agentTasks", "squads", "autopilots", "autopilotRuns"] as const;
  for (const collection of collections) {
    if (!Array.isArray(value[collection])) throw new Error(`schema v3 看板文件缺少 ${collection} 数组`);
  }
  return parseBoardState({ ...value, version: BOARD_SCHEMA_VERSION, customAgents: [] });
}

export interface ParsedBoardFile {
  readonly state: BoardState;
  readonly migratedFrom?: typeof LEGACY_BOARD_SCHEMA_VERSION | typeof BOARD_SCHEMA_V2 | typeof BOARD_SCHEMA_V3;
}

export function parseBoardFile(value: unknown): ParsedBoardFile {
  if (!isRecord(value)) throw new Error("看板文件根节点必须是对象");
  if (value.version === BOARD_SCHEMA_VERSION) return Object.freeze({ state: parseBoardState(value) });
  if (value.version === BOARD_SCHEMA_V3) {
    return Object.freeze({ state: migrateBoardStateV3(value), migratedFrom: BOARD_SCHEMA_V3 });
  }
  if (value.version === BOARD_SCHEMA_V2) {
    return Object.freeze({ state: migrateBoardStateV2(value), migratedFrom: BOARD_SCHEMA_V2 });
  }
  if (value.version === LEGACY_BOARD_SCHEMA_VERSION) {
    return Object.freeze({ state: migrateBoardStateV1(value), migratedFrom: LEGACY_BOARD_SCHEMA_VERSION });
  }
  throw new Error(`不支持的看板版本: ${String(value.version)}`);
}

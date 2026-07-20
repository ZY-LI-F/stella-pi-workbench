import { copyFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import {
  SessionManager,
  hasTrustRequiringProjectResources,
} from "@earendil-works/pi-coding-agent";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from "electron";
import type {
  ModelSummary,
  PiCommand,
  PiExtensionResponse,
  PiResponse,
  ProjectMeta,
  ProjectSelection,
  RuntimeBootstrap,
  SessionEntrySummary,
  SessionSummary,
  SessionTreeSummary,
  SlashCommandSummary,
} from "../shared/contracts";
import { CAPABILITY_NAMES, type CapabilityHealthSnapshot, type CapabilityName } from "../shared/capabilities";
import {
  AGENT_THINKING_LEVELS,
  MANUAL_TASK_STAGES,
  TASK_PRIORITIES,
  type BoardBootstrap,
  type CreateAutopilotInput,
  type CreateProjectAgentInput,
  type CreateTaskCommentInput,
  type CreateTaskInput,
  type LaunchTeamTaskInput,
  type ExecutionTarget,
  type CreateSquadInput,
  type ManualTaskStage,
  type OpenTaskSessionInput,
  type ReviewExecutionInput,
  type ResolveGateInput,
  type UpdateTaskInput,
  type UpdateAutopilotInput,
  type UpdateProjectAgentInput,
  type UpdateSquadInput,
} from "../shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../shared/orchestration-catalog";
import { runtimeModelSelectionFromSession, type RuntimeModelSelection } from "../shared/runtime-model";
import { AgentTaskRunner, type AgentTaskRuntimeFactory } from "./agent-task-runner";
import { AgentTaskService } from "./agent-task-service";
import { AutopilotService } from "./autopilot-service";
import { BoardService } from "./board-service";
import { BoardStore } from "./board-store";
import { CapabilityHealthStore } from "./capability-health";
import { ExecutionReviewService } from "./execution-review-service";
import { InteractiveCommandRouter } from "./interactive-command-router";
import { PiRpcRuntime } from "./pi-rpc-runtime";
import { ScheduleRunner } from "./schedule-runner";
import { StateStore } from "./state-store";
import { SquadService } from "./squad-service";
import { WorkflowOrchestrator, type WorkflowRuntimeFactory } from "./workflow-orchestrator";
import { WebhookServer, webhookMaxBytesFromEnvironment, webhookPortFromEnvironment } from "./webhook-server";
import { WorkspaceAdmission } from "./workspace-admission";
import { visibleInteractiveSessions } from "../shared/session-policy";
import { resolveTaskSessionTarget } from "../shared/task-session-bridge";
import { isSkinId, type SkinArtworkDescriptor, type SkinId } from "../shared/skin-artwork";
import { SkinArtworkService, type StoredSkinArtwork } from "./skin-artwork-service";
import {
  canonicalExecutionProjectPath,
  canonicalExistingPath,
  canonicalPathWithinRoots,
  pathComparisonKey,
} from "./path-security";

const rpcEntryPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
const preloadPath = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));
const SKIN_ARTWORK_SCHEME = "stella-artwork";

protocol.registerSchemesAsPrivileged([
  {
    scheme: SKIN_ARTWORK_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

interface CurrentProject {
  readonly cwd: string;
  readonly trusted: boolean;
}

interface RpcModelsData {
  readonly models: readonly Record<string, unknown>[];
}

interface RpcMessagesData {
  readonly messages: readonly unknown[];
}

interface RpcCommandsData {
  readonly commands: readonly Record<string, unknown>[];
}

interface RpcEntriesData {
  readonly entries: readonly Record<string, unknown>[];
  readonly leafId: string | null;
}

interface RpcTreeData {
  readonly tree: readonly Record<string, unknown>[];
  readonly leafId: string | null;
}

const PI_COMMAND_TYPES = new Set<string>([
  "prompt", "steer", "follow_up", "abort", "new_session", "get_state", "set_model",
  "cycle_model", "get_available_models", "set_thinking_level", "cycle_thinking_level",
  "set_steering_mode", "set_follow_up_mode", "compact", "set_auto_compaction",
  "set_auto_retry", "abort_retry", "bash", "abort_bash", "get_session_stats", "export_html",
  "switch_session", "fork", "clone", "get_fork_messages", "get_entries", "get_tree",
  "get_last_assistant_text", "set_session_name", "get_messages", "get_commands",
]);

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} 必须是非空字符串`);
  return value;
}

function validatedCommand(value: unknown): PiCommand {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Pi RPC 命令必须是对象");
  }
  const type = (value as Record<string, unknown>).type;
  if (typeof type !== "string" || !PI_COMMAND_TYPES.has(type)) {
    throw new Error(`不支持的 Pi RPC 命令: ${String(type)}`);
  }
  return value as PiCommand;
}

function validatedExtensionResponse(value: unknown): PiExtensionResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("扩展响应必须是对象");
  }
  const record = value as Record<string, unknown>;
  if (record.type !== "extension_ui_response") throw new Error("扩展响应类型无效");
  requiredString(record.id, "扩展响应 id");
  const validPayload =
    record.cancelled === true ||
    typeof record.confirmed === "boolean" ||
    typeof record.value === "string";
  if (!validPayload) throw new Error("扩展响应缺少 cancelled、confirmed 或 value");
  return value as PiExtensionResponse;
}

let mainWindow: BrowserWindow | null = null;
let currentProject: CurrentProject | null = null;
let globalModelSelection: RuntimeModelSelection | undefined;
let stateStore: StateStore;
let boardStore: BoardStore;
let boardService: BoardService;
let workflowOrchestrator: WorkflowOrchestrator;
let agentTaskService: AgentTaskService;
let agentTaskRunner: AgentTaskRunner;
let executionReviewService: ExecutionReviewService;
let squadService: SquadService;
let autopilotService: AutopilotService;
let scheduleRunner: ScheduleRunner;
let webhookServer: WebhookServer;
let skinArtworkService: SkinArtworkService;
const singleInstanceLock = app.requestSingleInstanceLock();

function broadcast(source: "pi" | "runtime" | "board" | "capability", payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("stella:event", { source, payload });
}

const capabilityHealth = new CapabilityHealthStore({
  now: () => new Date().toISOString(),
  emitChanged: (snapshot) => broadcast("capability", { type: "capability-health", snapshot }),
});
const workspaceAdmission = new WorkspaceAdmission();
let interactiveCommandRouter: InteractiveCommandRouter | undefined;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function assertTaskCapability(): void {
  const health = capabilityHealth.snapshot().task;
  if (health.state !== "ready") throw new Error(`Task Control 不可用：${health.error ?? health.state}`);
}

function assertPiExecutionCapability(): void {
  const health = capabilityHealth.snapshot().pi;
  if (health.state !== "ready") throw new Error(`Pi Runtime 不可用于任务执行：${health.error ?? health.state}`);
}

function validatedCapabilityName(value: unknown): CapabilityName {
  if (typeof value !== "string" || !CAPABILITY_NAMES.includes(value as CapabilityName)) {
    throw new Error(`未知 Capability: ${String(value)}`);
  }
  return value as CapabilityName;
}

const runtime = new PiRpcRuntime({
  executablePath: process.execPath,
  rpcEntryPath,
  spawnProcess: (command, args, options) => spawn(command, [...args], options),
  emitPiEvent: (event) => {
    interactiveCommandRouter?.handlePiEvent(event);
    broadcast("pi", event);
  },
  emitRuntimeSignal: (signal) => {
    interactiveCommandRouter?.handleRuntimeSignal(signal);
    if (signal.type === "runtime_exit") {
      capabilityHealth.set("pi", "error", `Pi RPC 意外退出 (code=${String(signal.code)}, signal=${String(signal.signal)})`);
    } else if (signal.type === "protocol_error") {
      capabilityHealth.set("pi", "degraded", `Pi RPC 协议错误：${signal.message}`);
    }
    broadcast("runtime", signal);
  },
});

interactiveCommandRouter = new InteractiveCommandRouter({ runtime, admission: workspaceAdmission });

const workflowRuntimeFactory: WorkflowRuntimeFactory = Object.freeze({
  create: (callbacks: Parameters<WorkflowRuntimeFactory["create"]>[0]) => new PiRpcRuntime({
    executablePath: process.execPath,
    rpcEntryPath,
    spawnProcess: (command, args, options) => spawn(command, [...args], options),
    emitPiEvent: callbacks.emitPiEvent,
    emitRuntimeSignal: callbacks.emitRuntimeSignal,
  }),
});

const agentTaskRuntimeFactory: AgentTaskRuntimeFactory = Object.freeze({
  create: (callbacks: Parameters<AgentTaskRuntimeFactory["create"]>[0]) => new PiRpcRuntime({
    executablePath: process.execPath,
    rpcEntryPath,
    spawnProcess: (command, args, options) => spawn(command, [...args], options),
    emitPiEvent: callbacks.emitPiEvent,
    emitRuntimeSignal: callbacks.emitRuntimeSignal,
  }),
});

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} 必须是布尔值`);
  return value;
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
  return value;
}

function stringArrayValue(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${label} 必须是字符串数组`);
  return Object.freeze([...value]);
}

function validatedExecutionTarget(value: unknown): ExecutionTarget {
  const target = objectValue(value, "executionTarget");
  if (target.kind === "workflow") {
    return Object.freeze({ kind: "workflow", workflowId: requiredString(target.workflowId, "workflowId") });
  }
  if (target.kind === "agent") {
    return Object.freeze({ kind: "agent", agentId: requiredString(target.agentId, "agentId") });
  }
  if (target.kind === "squad") {
    return Object.freeze({ kind: "squad", squadId: requiredString(target.squadId, "squadId") });
  }
  throw new Error(`不支持的执行目标: ${String(target.kind)}`);
}

function validatedCreateTask(value: unknown): CreateTaskInput {
  const input = objectValue(value, "创建任务参数");
  const priority = textValue(input.priority, "priority");
  if (!TASK_PRIORITIES.includes(priority as CreateTaskInput["priority"])) throw new Error(`无效优先级: ${priority}`);
  return Object.freeze({
    title: textValue(input.title, "title"),
    description: textValue(input.description, "description"),
    acceptanceCriteria: textValue(input.acceptanceCriteria, "acceptanceCriteria"),
    priority: priority as CreateTaskInput["priority"],
    projectPath: textValue(input.projectPath, "projectPath"),
    projectName: textValue(input.projectName, "projectName"),
    trusted: booleanValue(input.trusted, "trusted"),
    executionTarget: validatedExecutionTarget(input.executionTarget),
    sourcePiSessionPath: input.sourcePiSessionPath === undefined ? undefined : textValue(input.sourcePiSessionPath, "sourcePiSessionPath"),
    sourcePiSessionId: input.sourcePiSessionId === undefined ? undefined : textValue(input.sourcePiSessionId, "sourcePiSessionId"),
  });
}

function validatedOpenTaskSession(value: unknown): OpenTaskSessionInput {
  const input = objectValue(value, "打开任务会话参数");
  return Object.freeze({
    taskId: requiredString(input.taskId, "taskId"),
    sessionPath: requiredString(input.sessionPath, "sessionPath"),
  });
}

function validatedUpdateTask(value: unknown): UpdateTaskInput {
  const input = objectValue(value, "更新任务参数");
  const priority = textValue(input.priority, "priority");
  if (!TASK_PRIORITIES.includes(priority as UpdateTaskInput["priority"])) throw new Error(`无效优先级: ${priority}`);
  return Object.freeze({
    taskId: requiredString(input.taskId, "taskId"),
    title: textValue(input.title, "title"),
    description: textValue(input.description, "description"),
    acceptanceCriteria: textValue(input.acceptanceCriteria, "acceptanceCriteria"),
    priority: priority as UpdateTaskInput["priority"],
    executionTarget: validatedExecutionTarget(input.executionTarget),
  });
}

function validatedManualStage(value: unknown): ManualTaskStage {
  if (typeof value !== "string" || !MANUAL_TASK_STAGES.includes(value as ManualTaskStage)) {
    throw new Error(`不支持的手动任务阶段: ${String(value)}`);
  }
  return value as ManualTaskStage;
}

function validatedGate(value: unknown): ResolveGateInput {
  const input = objectValue(value, "人工关卡参数");
  if (input.decision !== "approve" && input.decision !== "reject") throw new Error("decision 必须是 approve 或 reject");
  return Object.freeze({
    taskId: requiredString(input.taskId, "taskId"),
    decision: input.decision,
    comment: textValue(input.comment, "comment"),
  });
}

function validatedExecutionReview(value: unknown): ReviewExecutionInput {
  const input = objectValue(value, "执行验收参数");
  if (input.executionKind !== "workflow" && input.executionKind !== "agent-task") {
    throw new Error(`不支持的 executionKind: ${String(input.executionKind)}`);
  }
  if (input.decision !== "accept" && input.decision !== "revision-requested" && input.decision !== "reject") {
    throw new Error(`不支持的验收决定: ${String(input.decision)}`);
  }
  return Object.freeze({
    taskId: requiredString(input.taskId, "taskId"),
    executionKind: input.executionKind,
    executionId: requiredString(input.executionId, "executionId"),
    decision: input.decision,
    comment: textValue(input.comment, "comment"),
  });
}

function validatedTaskComment(value: unknown): CreateTaskCommentInput {
  const input = objectValue(value, "任务评论参数");
  return Object.freeze({
    taskId: requiredString(input.taskId, "taskId"),
    body: textValue(input.body, "body"),
  });
}

function validatedTeamLaunch(value: unknown): LaunchTeamTaskInput {
  const input = objectValue(value, "团队启动参数");
  return Object.freeze({ body: textValue(input.body, "body") });
}

function validatedProjectAgent(value: unknown): CreateProjectAgentInput {
  const input = objectValue(value, "自定义 Agent 参数");
  if (input.workspaceAccess !== "read" && input.workspaceAccess !== "write") throw new Error("workspaceAccess 必须是 read 或 write");
  const thinking = textValue(input.thinking, "thinking");
  if (!AGENT_THINKING_LEVELS.includes(thinking as CreateProjectAgentInput["thinking"])) throw new Error(`不支持的 thinking: ${thinking}`);
  return Object.freeze({
    name: textValue(input.name, "name"),
    callsign: textValue(input.callsign, "callsign"),
    responsibility: textValue(input.responsibility, "responsibility"),
    instructions: textValue(input.instructions, "instructions"),
    workspaceAccess: input.workspaceAccess,
    allowedTools: stringArrayValue(input.allowedTools, "allowedTools"),
    requiredSkills: input.requiredSkills === undefined ? undefined : stringArrayValue(input.requiredSkills, "requiredSkills"),
    thinking: thinking as CreateProjectAgentInput["thinking"],
    provider: input.provider === undefined ? undefined : textValue(input.provider, "provider"),
    model: input.model === undefined ? undefined : textValue(input.model, "model"),
    disableExtensions: booleanValue(input.disableExtensions, "disableExtensions"),
    disableSkills: booleanValue(input.disableSkills, "disableSkills"),
    disablePromptTemplates: booleanValue(input.disablePromptTemplates, "disablePromptTemplates"),
    projectPath: textValue(input.projectPath, "projectPath"),
  });
}

function validatedUpdateProjectAgent(value: unknown): UpdateProjectAgentInput {
  const input = objectValue(value, "更新自定义 Agent 参数");
  return Object.freeze({ ...validatedProjectAgent(input), agentId: requiredString(input.agentId, "agentId") });
}

async function createProjectAgentForCurrentProject(value: unknown): Promise<BoardBootstrap> {
  assertTaskCapability();
  if (!currentProject) throw new Error("尚未选择项目");
  const input = validatedProjectAgent(value);
  if (resolve(input.projectPath) !== currentProject.cwd) throw new Error("自定义 Agent 必须属于当前主进程工作区");
  return boardService.createProjectAgent(Object.freeze({ ...input, projectPath: currentProject.cwd }));
}

async function updateProjectAgentForCurrentProject(value: unknown): Promise<BoardBootstrap> {
  assertTaskCapability();
  if (!currentProject) throw new Error("尚未选择项目");
  const input = validatedUpdateProjectAgent(value);
  if (resolve(input.projectPath) !== currentProject.cwd) throw new Error("自定义 Agent 必须属于当前主进程工作区");
  return boardService.updateProjectAgent(Object.freeze({ ...input, projectPath: currentProject.cwd }));
}

function validatedCreateSquad(value: unknown): CreateSquadInput {
  const input = objectValue(value, "创建 Squad 参数");
  return Object.freeze({
    name: textValue(input.name, "name"),
    description: textValue(input.description, "description"),
    leaderAgentId: textValue(input.leaderAgentId, "leaderAgentId"),
    memberAgentIds: stringArrayValue(input.memberAgentIds, "memberAgentIds"),
    leaderInstructions: textValue(input.leaderInstructions, "leaderInstructions"),
  });
}

function validatedUpdateSquad(value: unknown): UpdateSquadInput {
  const input = objectValue(value, "更新 Squad 参数");
  return Object.freeze({ ...validatedCreateSquad(input), squadId: requiredString(input.squadId, "squadId") });
}

function validatedAutopilotTemplate(value: unknown): CreateAutopilotInput["taskTemplate"] {
  const template = objectValue(value, "Autopilot taskTemplate");
  const priority = textValue(template.priority, "taskTemplate.priority");
  if (!TASK_PRIORITIES.includes(priority as CreateAutopilotInput["taskTemplate"]["priority"])) {
    throw new Error(`无效优先级: ${priority}`);
  }
  return Object.freeze({
    title: textValue(template.title, "taskTemplate.title"),
    description: textValue(template.description, "taskTemplate.description"),
    acceptanceCriteria: textValue(template.acceptanceCriteria, "taskTemplate.acceptanceCriteria"),
    priority: priority as CreateAutopilotInput["taskTemplate"]["priority"],
  });
}

function validatedCreateAutopilotTrigger(value: unknown): CreateAutopilotInput["trigger"] {
  const trigger = objectValue(value, "Autopilot trigger");
  if (trigger.kind === "manual") return Object.freeze({ kind: "manual" });
  if (trigger.kind === "webhook") return Object.freeze({ kind: "webhook" });
  if (trigger.kind === "schedule") {
    const intervalMinutes = trigger.intervalMinutes;
    if (typeof intervalMinutes !== "number" || !Number.isInteger(intervalMinutes) || intervalMinutes <= 0) {
      throw new Error("trigger.intervalMinutes 必须是正整数");
    }
    return Object.freeze({
      kind: "schedule",
      intervalMinutes,
      nextRunAt: textValue(trigger.nextRunAt, "trigger.nextRunAt"),
    });
  }
  throw new Error(`不支持的 Autopilot 触发类型: ${String(trigger.kind)}`);
}

function validatedCreateAutopilot(value: unknown): CreateAutopilotInput {
  const input = objectValue(value, "创建 Autopilot 参数");
  return Object.freeze({
    name: textValue(input.name, "name"),
    enabled: booleanValue(input.enabled, "enabled"),
    trigger: validatedCreateAutopilotTrigger(input.trigger),
    taskTemplate: validatedAutopilotTemplate(input.taskTemplate),
    projectPath: textValue(input.projectPath, "projectPath"),
    projectName: textValue(input.projectName, "projectName"),
    trusted: booleanValue(input.trusted, "trusted"),
    executionTarget: validatedExecutionTarget(input.executionTarget),
  });
}

function validatedUpdateAutopilot(value: unknown): UpdateAutopilotInput {
  const input = objectValue(value, "更新 Autopilot 参数");
  const base = validatedCreateAutopilot(input);
  const rawTrigger = objectValue(input.trigger, "Autopilot trigger");
  let trigger: UpdateAutopilotInput["trigger"];
  if (rawTrigger.kind === "webhook") {
    trigger = Object.freeze({ kind: "webhook", token: requiredString(rawTrigger.token, "trigger.token") });
  } else if (rawTrigger.kind === "manual") {
    trigger = Object.freeze({ kind: "manual" });
  } else if (rawTrigger.kind === "schedule") {
    const schedule = validatedCreateAutopilotTrigger(rawTrigger);
    if (schedule.kind !== "schedule") throw new Error("Autopilot schedule trigger 解析失败");
    trigger = schedule;
  } else {
    throw new Error(`不支持的 Autopilot 触发类型: ${String(rawTrigger.kind)}`);
  }
  return Object.freeze({ ...base, autopilotId: requiredString(input.autopilotId, "autopilotId"), trigger });
}

async function createAutopilotForCurrentProject(value: unknown): Promise<BoardBootstrap> {
  assertTaskCapability();
  if (!currentProject) throw new Error("尚未选择项目");
  const input = validatedCreateAutopilot(value);
  if (resolve(input.projectPath) !== currentProject.cwd) throw new Error("Autopilot 项目必须与当前主进程工作区一致");
  const project = await getProjectMeta(currentProject);
  const bootstrap = await autopilotService.create(Object.freeze({
    ...input,
    projectPath: project.cwd,
    projectName: project.name,
    trusted: project.trusted,
  }));
  await notifyScheduleCapability();
  return bootstrap;
}

async function updateAutopilotForCurrentProject(value: unknown): Promise<BoardBootstrap> {
  assertTaskCapability();
  if (!currentProject) throw new Error("尚未选择项目");
  const input = validatedUpdateAutopilot(value);
  if (resolve(input.projectPath) !== currentProject.cwd) throw new Error("Autopilot 项目必须与当前主进程工作区一致");
  const project = await getProjectMeta(currentProject);
  const bootstrap = await autopilotService.update(Object.freeze({
    ...input,
    projectPath: project.cwd,
    projectName: project.name,
    trusted: project.trusted,
  }));
  await notifyScheduleCapability();
  return bootstrap;
}

async function deleteAutopilot(autopilotId: string): Promise<BoardBootstrap> {
  assertTaskCapability();
  const bootstrap = await autopilotService.delete(autopilotId);
  await notifyScheduleCapability();
  return bootstrap;
}

async function createBoardTaskForCurrentProject(value: unknown): Promise<BoardBootstrap> {
  assertTaskCapability();
  if (!currentProject) throw new Error("尚未选择项目");
  const input = validatedCreateTask(value);
  if (resolve(input.projectPath) !== currentProject.cwd) {
    throw new Error("任务项目必须与当前主进程工作区一致");
  }
  const project = await getProjectMeta(currentProject);
  return boardService.createTask(Object.freeze({
    ...input,
    projectPath: project.cwd,
    projectName: project.name,
    trusted: project.trusted,
  }));
}

async function launchTeamTaskForCurrentProject(value: unknown): Promise<BoardBootstrap> {
  assertTaskCapability();
  assertPiExecutionCapability();
  if (!currentProject) throw new Error("尚未选择项目");
  const input = validatedTeamLaunch(value);
  const project = await getProjectMeta(currentProject);
  const bootstrap = await agentTaskService.launchTeamTask(Object.freeze({
    ...input,
    projectPath: project.cwd,
    projectName: project.name,
    trusted: project.trusted,
  }));
  agentTaskRunner.notify();
  return bootstrap;
}

async function dispatchBoardTask(taskId: string): Promise<BoardBootstrap> {
  assertTaskCapability();
  assertPiExecutionCapability();
  const state = await boardStore.read();
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`找不到任务: ${taskId}`);
  if (task.executionTarget.kind === "workflow") return workflowOrchestrator.dispatch(taskId);
  if (task.executionTarget.kind === "agent") {
    const bootstrap = await agentTaskService.dispatchDirect(taskId);
    agentTaskRunner.notify();
    return bootstrap;
  }
  const bootstrap = await agentTaskService.dispatchSquad(taskId);
  agentTaskRunner.notify();
  return bootstrap;
}

async function abortBoardTask(taskId: string): Promise<BoardBootstrap> {
  assertTaskCapability();
  const state = await boardStore.read();
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`找不到任务: ${taskId}`);
  if (task.activeRunId) return workflowOrchestrator.abort(taskId);
  if (task.activeAgentTaskId) return agentTaskRunner.abortTask(taskId);
  throw new Error("任务当前没有可中止的执行");
}

function dataFromResponse<T>(response: PiResponse, command: string): T {
  if (!response.success) throw new Error(response.error);
  if (!("data" in response)) throw new Error(`Pi RPC 命令 ${command} 没有返回 data`);
  return response.data as T;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapModel(model: Record<string, unknown>): ModelSummary {
  const provider = stringValue(model.provider);
  const id = stringValue(model.id);
  return Object.freeze({
    provider,
    id,
    name: stringValue(model.name) || id,
    contextWindow: numberValue(model.contextWindow),
    reasoning: Boolean(model.reasoning),
  });
}

function mapCommand(command: Record<string, unknown>): SlashCommandSummary {
  const sourceInfo =
    typeof command.sourceInfo === "object" && command.sourceInfo !== null
      ? (command.sourceInfo as Record<string, unknown>)
      : {};
  const rawSource = stringValue(command.source);
  const source = rawSource === "extension" || rawSource === "skill" ? rawSource : "prompt";
  return Object.freeze({
    name: stringValue(command.name),
    description: typeof command.description === "string" ? command.description : undefined,
    source,
    location: typeof sourceInfo.location === "string" ? sourceInfo.location : undefined,
    path: typeof sourceInfo.path === "string" ? sourceInfo.path : undefined,
  });
}

function mapSessionEntry(entry: Record<string, unknown>): SessionEntrySummary {
  return Object.freeze({
    id: stringValue(entry.id),
    parentId: typeof entry.parentId === "string" ? entry.parentId : null,
    type: stringValue(entry.type),
    timestamp: stringValue(entry.timestamp),
    message:
      typeof entry.message === "object" && entry.message !== null
        ? (entry.message as SessionEntrySummary["message"])
        : undefined,
  });
}

function mapTreeNode(node: Record<string, unknown>): SessionTreeSummary {
  if (typeof node.entry !== "object" || node.entry === null) {
    throw new Error("Pi RPC 返回的会话树节点缺少 entry");
  }
  const children = Array.isArray(node.children)
    ? node.children.map((child) => {
        if (typeof child !== "object" || child === null) throw new Error("Pi RPC 返回了无效的会话树子节点");
        return mapTreeNode(child as Record<string, unknown>);
      })
    : [];
  return Object.freeze({
    entry: mapSessionEntry(node.entry as Record<string, unknown>),
    children: Object.freeze(children),
    label: typeof node.label === "string" ? node.label : undefined,
  });
}

function mapSession(session: Awaited<ReturnType<typeof SessionManager.list>>[number]): SessionSummary {
  return Object.freeze({
    path: session.path,
    id: session.id,
    cwd: session.cwd,
    name: session.name,
    parentSessionPath: session.parentSessionPath,
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
  });
}

async function readGitBranch(cwd: string): Promise<string | undefined> {
  const dotGitPath = join(cwd, ".git");
  let headPath = join(dotGitPath, "HEAD");
  try {
    const dotGit = await stat(dotGitPath);
    if (dotGit.isFile()) {
      const pointer = (await readFile(dotGitPath, "utf8")).trim();
      if (!pointer.startsWith("gitdir:")) throw new Error(`${dotGitPath} 不是有效的 gitdir 指针`);
      headPath = join(resolve(cwd, pointer.slice("gitdir:".length).trim()), "HEAD");
    }
    const head = (await readFile(headPath, "utf8")).trim();
    return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : head.slice(0, 8);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function getPiVersion(): Promise<string> {
  const packagePath = join(dirname(rpcEntryPath), "..", "package.json");
  const parsed = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
  if (typeof parsed.version !== "string") throw new Error(`${packagePath} 缺少 version`);
  return parsed.version;
}

async function getProjectMeta(project: CurrentProject): Promise<ProjectMeta> {
  return Object.freeze({
    cwd: project.cwd,
    name: basename(project.cwd) || project.cwd,
    branch: await readGitBranch(project.cwd),
    trusted: project.trusted,
    requiresTrust: hasTrustRequiringProjectResources(project.cwd),
  });
}

async function hydrate(): Promise<RuntimeBootstrap> {
  if (!currentProject) throw new Error("尚未选择项目");
  if (!runtime.running) await runtime.start(currentProject);

  const [stateResponse, messagesResponse, modelsResponse, commandsResponse, statsResponse, entriesResponse, treeResponse] =
    await Promise.all([
      runtime.send({ type: "get_state" }),
      runtime.send({ type: "get_messages" }),
      runtime.send({ type: "get_available_models" }),
      runtime.send({ type: "get_commands" }),
      runtime.send({ type: "get_session_stats" }),
      runtime.send({ type: "get_entries" }),
      runtime.send({ type: "get_tree" }),
    ]);

  const state = dataFromResponse<RuntimeBootstrap["state"]>(stateResponse, "get_state");
  globalModelSelection = runtimeModelSelectionFromSession(state.model);
  const messages = dataFromResponse<RpcMessagesData>(messagesResponse, "get_messages").messages;
  const models = dataFromResponse<RpcModelsData>(modelsResponse, "get_available_models").models.map(mapModel);
  const commands = dataFromResponse<RpcCommandsData>(commandsResponse, "get_commands").commands.map(mapCommand);
  const stats = dataFromResponse<RuntimeBootstrap["stats"]>(statsResponse, "get_session_stats");
  const entriesData = dataFromResponse<RpcEntriesData>(entriesResponse, "get_entries");
  const treeData = dataFromResponse<RpcTreeData>(treeResponse, "get_tree");
  const [sessions, persisted, project, piVersion] = await Promise.all([
    SessionManager.list(currentProject.cwd),
    stateStore.read(),
    getProjectMeta(currentProject),
    getPiVersion(),
  ]);

  return Object.freeze({
    project,
    recentProjects: persisted.recentProjects,
    state,
    messages: messages as RuntimeBootstrap["messages"],
    models: Object.freeze(models),
    commands: Object.freeze(commands),
    sessions: visibleInteractiveSessions(sessions.map(mapSession)),
    stats,
    entries: Object.freeze(entriesData.entries.map(mapSessionEntry)),
    tree: Object.freeze(
      treeData.tree.map((node) => mapTreeNode(node)),
    ),
    leafId: treeData.leafId ?? entriesData.leafId,
    piVersion,
  });
}

async function initializeRuntime(): Promise<RuntimeBootstrap> {
  capabilityHealth.set("pi", "loading");
  try {
    if (!currentProject) {
      const persisted = await stateStore.read();
      const requestedPath = resolve(persisted.lastProject ?? (app.isPackaged ? app.getPath("documents") : process.cwd()));
      const cwd = await canonicalProjectDirectory(requestedPath);
      const remembered = persisted.recentProjects.find(
        (project) => canonicalSessionPath(project.path) === canonicalSessionPath(requestedPath),
      );
      const identityUnchanged = canonicalSessionPath(requestedPath) === canonicalSessionPath(cwd);
      currentProject = Object.freeze({ cwd, trusted: identityUnchanged && (remembered?.trusted ?? false) });
    }
    const bootstrap = await hydrate();
    capabilityHealth.set("pi", "ready");
    return bootstrap;
  } catch (cause) {
    capabilityHealth.set("pi", "error", errorMessage(cause));
    throw cause;
  }
}

function validatedSkinId(value: unknown): SkinId {
  if (!isSkinId(value)) throw new Error(`不支持的皮肤: ${String(value)}`);
  return value;
}

function skinArtworkDescriptor(record: StoredSkinArtwork): SkinArtworkDescriptor {
  return Object.freeze({
    skin: record.skin,
    url: `${SKIN_ARTWORK_SCHEME}://skin/${record.skin}?v=${encodeURIComponent(String(record.updatedAt))}`,
    updatedAt: record.updatedAt,
  });
}

async function initializeSkinArtwork(): Promise<readonly SkinArtworkDescriptor[]> {
  const records = await skinArtworkService.list();
  return Object.freeze(records.map(skinArtworkDescriptor));
}

async function chooseSkinArtwork(value: unknown): Promise<SkinArtworkDescriptor | null> {
  const skin = validatedSkinId(value);
  const options: Electron.OpenDialogOptions = {
    title: `为 ${skin} 皮肤选择背景图片`,
    buttonLabel: "使用此图片",
    properties: ["openFile"],
    filters: [{ name: "背景图片（最大 25 MB）", extensions: ["png", "jpg", "jpeg", "webp"] }],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  if (result.canceled || !path) return null;
  return skinArtworkDescriptor(await skinArtworkService.install(skin, path));
}

function registerSkinArtworkProtocol(): void {
  protocol.handle(SKIN_ARTWORK_SCHEME, async (request) => {
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });
    const url = new URL(request.url);
    const skinValue = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (url.hostname !== "skin" || !isSkinId(skinValue)) {
      return new Response("Invalid skin artwork request", { status: 400 });
    }
    const artwork = await skinArtworkService.find(skinValue);
    if (!artwork) return new Response("Skin artwork not found", { status: 404 });
    return net.fetch(pathToFileURL(artwork.path).toString());
  });
}

async function chooseProject(): Promise<ProjectSelection | null> {
  const options: Electron.OpenDialogOptions = {
    title: "选择 Pi 工作目录",
    buttonLabel: "打开项目",
    properties: ["openDirectory", "createDirectory"],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  const selectedPath = result.filePaths[0];
  if (result.canceled || !selectedPath) return null;
  const path = await canonicalProjectDirectory(selectedPath);
  return Object.freeze({
    path,
    name: basename(path) || path,
    requiresTrust: hasTrustRequiringProjectResources(path),
  });
}

async function confirmTrustEscalation(resolvedPath: string): Promise<boolean | null> {
  const persisted = await stateStore.read();
  const remembered = persisted.recentProjects.find(
    (project) => canonicalSessionPath(project.path) === canonicalSessionPath(resolvedPath),
  );
  if (remembered?.trusted) return true;
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error("无法显示项目信任确认窗口，已拒绝信任模式启动");
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "确认信任项目",
    message: "以信任模式打开该项目？",
    detail: `${resolvedPath}\n\n信任模式会让 Pi 以 --approve 运行，自动执行该项目内的命令与扩展。请仅对来源可信的项目启用。`,
    buttons: ["取消", "以受限模式打开", "信任并打开"],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  if (response === 0) return null;
  return response === 2;
}

async function openProject(path: string, trusted: boolean): Promise<RuntimeBootstrap> {
  const resolvedPath = await canonicalProjectDirectory(path);
  capabilityHealth.set("pi", "loading");
  try {
    await runtime.stop();
    interactiveCommandRouter?.release();
    currentProject = Object.freeze({ cwd: resolvedPath, trusted });
    await runtime.start(currentProject);
    await stateStore.recordProject(resolvedPath, trusted);
    const bootstrap = await hydrate();
    capabilityHealth.set("pi", "ready");
    return bootstrap;
  } catch (cause) {
    capabilityHealth.set("pi", "error", errorMessage(cause));
    throw cause;
  }
}

function canonicalSessionPath(path: string): string {
  return pathComparisonKey(path);
}

async function canonicalProjectDirectory(path: string): Promise<string> {
  const canonical = await canonicalExistingPath(path);
  const metadata = await stat(canonical);
  if (!metadata.isDirectory()) throw new Error(`项目路径不是目录: ${canonical}`);
  return canonical;
}

function piAgentDir(): string {
  const override = process.env.PI_CODING_AGENT_DIR;
  if (override) return resolve(override.replace(/^~(?=$|[\\/])/, homedir()));
  return join(homedir(), ".pi", "agent");
}

function allowedRevealRoots(): readonly string[] {
  const roots = [piAgentDir(), app.getPath("userData"), tmpdir()];
  if (currentProject) roots.push(currentProject.cwd);
  return Object.freeze(roots);
}

async function openTaskSession(value: unknown): Promise<RuntimeBootstrap> {
  assertTaskCapability();
  assertPiExecutionCapability();
  const state = await boardStore.read();
  const target = resolveTaskSessionTarget(state, validatedOpenTaskSession(value), canonicalSessionPath);
  const requestedProjectPath = resolve(target.projectPath);
  const projectPath = await canonicalExecutionProjectPath(requestedProjectPath, target.trusted);
  const project = await stat(projectPath);
  if (!project.isDirectory()) throw new Error(`任务项目路径不是目录: ${projectPath}`);
  const sessionPath = await canonicalExistingPath(target.sessionPath);
  const session = await stat(sessionPath);
  if (!session.isFile()) throw new Error(`任务 session 不是文件: ${sessionPath}`);
  capabilityHealth.set("pi", "loading");
  try {
    await runtime.stop();
    interactiveCommandRouter?.release();
    currentProject = Object.freeze({ cwd: projectPath, trusted: target.trusted });
    await runtime.start({ ...currentProject, sessionPath });
    await stateStore.recordProject(currentProject.cwd, currentProject.trusted);
    const bootstrap = await hydrate();
    capabilityHealth.set("pi", "ready");
    return bootstrap;
  } catch (cause) {
    capabilityHealth.set("pi", "error", errorMessage(cause));
    throw cause;
  }
}

async function refreshPiCapability(): Promise<RuntimeBootstrap> {
  try {
    const bootstrap = await hydrate();
    capabilityHealth.set("pi", "ready");
    return bootstrap;
  } catch (cause) {
    capabilityHealth.set("pi", "error", errorMessage(cause));
    throw cause;
  }
}

async function startScheduleCapability(): Promise<void> {
  if (capabilityHealth.snapshot().task.state !== "ready") {
    capabilityHealth.set("schedule", "error", "Task Control 未就绪，Schedule 无法启动");
    return;
  }
  await capabilityHealth.run("schedule", () => scheduleRunner.start());
}

async function notifyScheduleCapability(): Promise<void> {
  if (capabilityHealth.snapshot().schedule.state !== "ready") return;
  try {
    await scheduleRunner.notify();
  } catch (cause) {
    capabilityHealth.set("schedule", "error", errorMessage(cause));
  }
}

async function startWebhookCapability(): Promise<void> {
  if (capabilityHealth.snapshot().task.state !== "ready") {
    capabilityHealth.set("webhook", "error", "Task Control 未就绪，Webhook 无法启动");
    return;
  }
  await capabilityHealth.run("webhook", async () => { await webhookServer.start(); });
}

async function initializeTaskCapability(): Promise<void> {
  capabilityHealth.set("task", "loading");
  try {
    boardStore = new BoardStore(join(app.getPath("userData"), "board", "board.json"));
    await boardStore.initialize();
    const emitSnapshot = (bootstrap: BoardBootstrap): void => broadcast("board", { type: "snapshot", bootstrap });
    boardService = new BoardService({
      repository: boardStore,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: emitSnapshot,
    });
    workflowOrchestrator = new WorkflowOrchestrator({
      repository: boardStore,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      runtimeFactory: workflowRuntimeFactory,
      emitBoardEvent: (event) => broadcast("board", event),
      admission: workspaceAdmission,
      globalModel: () => globalModelSelection,
      resolveProjectPath: canonicalExecutionProjectPath,
    });
    agentTaskService = new AgentTaskService({
      repository: boardStore,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: emitSnapshot,
    });
    executionReviewService = new ExecutionReviewService({
      repository: boardStore,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: emitSnapshot,
    });
    squadService = new SquadService({
      repository: boardStore,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      emitChanged: emitSnapshot,
    });
    autopilotService = new AutopilotService({
      repository: boardStore,
      catalog: BUILTIN_ORCHESTRATION_CATALOG,
      dispatchTask: dispatchBoardTask,
      emitChanged: emitSnapshot,
    });
    scheduleRunner = new ScheduleRunner({
      repository: boardStore,
      autopilotService,
      emitBoardEvent: (event) => broadcast("board", event),
    });
    webhookServer = new WebhookServer({
      autopilotService,
      emitBoardEvent: (event) => broadcast("board", event),
      port: webhookPortFromEnvironment(process.env.STELLA_WEBHOOK_PORT),
      maxBodyBytes: webhookMaxBytesFromEnvironment(process.env.STELLA_WEBHOOK_MAX_BYTES),
    });
    agentTaskRunner = new AgentTaskRunner({
      service: agentTaskService,
      runtimeFactory: agentTaskRuntimeFactory,
      emitBoardEvent: (event) => broadcast("board", event),
      admission: workspaceAdmission,
      globalModel: () => globalModelSelection,
      resolveProjectPath: canonicalExecutionProjectPath,
    });
    agentTaskRunner.start();
    capabilityHealth.set("task", "ready");
    await Promise.all([startScheduleCapability(), startWebhookCapability()]);
  } catch (cause) {
    const message = errorMessage(cause);
    capabilityHealth.set("task", "error", message);
    capabilityHealth.set("schedule", "error", `Task Control 初始化失败：${message}`);
    capabilityHealth.set("webhook", "error", `Task Control 初始化失败：${message}`);
  }
}

async function retryCapability(name: CapabilityName): Promise<CapabilityHealthSnapshot> {
  if (name === "pi") {
    try {
      await initializeRuntime();
    } catch {
      // initializeRuntime 已把精确错误写入 Capability Health。
    }
  } else if (name === "task") {
    await initializeTaskCapability();
  } else if (name === "schedule") {
    await startScheduleCapability();
  } else {
    await startWebhookCapability();
  }
  return capabilityHealth.snapshot();
}

function registerIpcHandlers(): void {
  ipcMain.handle("stella:capabilities", () => capabilityHealth.snapshot());
  ipcMain.handle("stella:capability:retry", (_event, name: unknown) => retryCapability(validatedCapabilityName(name)));
  ipcMain.handle("stella:initialize", () => initializeRuntime());
  ipcMain.handle("stella:refresh", () => refreshPiCapability());
  ipcMain.handle("stella:command", (_event, command: unknown) => {
    assertPiExecutionCapability();
    if (!currentProject) throw new Error("尚未选择项目");
    if (!interactiveCommandRouter) throw new Error("Interactive command router 尚未初始化");
    return interactiveCommandRouter.send(validatedCommand(command), currentProject.cwd);
  });
  ipcMain.handle("stella:extension-response", (_event, response: unknown) => {
    assertPiExecutionCapability();
    return runtime.respondToExtension(validatedExtensionResponse(response));
  });
  ipcMain.handle("stella:choose-project", () => chooseProject());
  ipcMain.handle("stella:skin-artwork:initialize", () => initializeSkinArtwork());
  ipcMain.handle("stella:skin-artwork:choose", (_event, skin: unknown) => chooseSkinArtwork(skin));
  ipcMain.handle("stella:skin-artwork:reset", async (_event, skin: unknown) => {
    await skinArtworkService.reset(validatedSkinId(skin));
  });
  ipcMain.handle("stella:open-project", async (_event, path: unknown, trusted: unknown) => {
    if (typeof trusted !== "boolean") throw new Error("项目 trusted 参数必须是布尔值");
    const projectPath = await canonicalProjectDirectory(requiredString(path, "项目路径"));
    const trustDecision = trusted ? await confirmTrustEscalation(projectPath) : false;
    if (trustDecision === null) return null;
    const grantTrust = trustDecision;
    return openProject(projectPath, grantTrust);
  });
  ipcMain.handle("stella:reveal-path", async (_event, path: unknown) => {
    const requestedPath = requiredString(path, "待显示路径");
    const resolvedPath = resolve(requestedPath);
    if (/^[\\/]{2}/.test(requestedPath) || /^[\\/]{2}/.test(resolvedPath)) {
      throw new Error(`不允许显示网络（UNC）路径: ${requestedPath}`);
    }
    const canonicalPath = await canonicalPathWithinRoots(resolvedPath, allowedRevealRoots());
    if (!canonicalPath) {
      throw new Error(`只允许显示当前项目、Pi 数据或应用数据目录内的路径: ${resolvedPath}`);
    }
    const target = await stat(canonicalPath);
    if (target.isDirectory()) {
      const error = await shell.openPath(canonicalPath);
      if (error) throw new Error(error);
      return;
    }
    shell.showItemInFolder(canonicalPath);
  });
  ipcMain.handle("stella:open-external", async (_event, url: unknown) => {
    const parsed = new URL(requiredString(url, "外部链接"));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`不允许打开协议 ${parsed.protocol}`);
    }
    await shell.openExternal(parsed.toString());
  });
  ipcMain.handle("stella:copy-text", (_event, value: unknown) => {
    clipboard.writeText(textValue(value, "待复制文本"));
  });
  ipcMain.handle("stella:board:initialize", async () => {
    assertTaskCapability();
    const bootstrap = await boardService.bootstrap();
    webhookServer.emitStatus();
    return bootstrap;
  });
  ipcMain.handle("stella:board:create-task", (_event, input: unknown) => createBoardTaskForCurrentProject(input));
  ipcMain.handle("stella:board:launch-team-task", (_event, input: unknown) => launchTeamTaskForCurrentProject(input));
  ipcMain.handle("stella:board:update-task", (_event, input: unknown) => {
    assertTaskCapability();
    return boardService.updateTask(validatedUpdateTask(input));
  });
  ipcMain.handle("stella:board:move-task", (_event, taskId: unknown, status: unknown) => {
    assertTaskCapability();
    return boardService.moveTask(requiredString(taskId, "taskId"), validatedManualStage(status));
  });
  ipcMain.handle("stella:board:delete-task", (_event, taskId: unknown) => {
    assertTaskCapability();
    return boardService.deleteTask(requiredString(taskId, "taskId"));
  });
  ipcMain.handle("stella:board:add-comment", async (_event, input: unknown) => {
    assertTaskCapability();
    const bootstrap = await agentTaskService.addComment(validatedTaskComment(input));
    agentTaskRunner.notify();
    return bootstrap;
  });
  ipcMain.handle("stella:board:create-agent", (_event, input: unknown) => createProjectAgentForCurrentProject(input));
  ipcMain.handle("stella:board:update-agent", (_event, input: unknown) => updateProjectAgentForCurrentProject(input));
  ipcMain.handle("stella:board:delete-agent", async (_event, agentId: unknown) => {
    assertTaskCapability();
    if (!currentProject) throw new Error("尚未选择项目");
    const validatedId = requiredString(agentId, "agentId");
    const state = await boardStore.read();
    const agent = state.customAgents.find((candidate) => candidate.id === validatedId);
    if (!agent) throw new Error(`找不到自定义 Agent: ${validatedId}`);
    if (resolve(agent.projectPath) !== currentProject.cwd) throw new Error("只能删除当前项目的自定义 Agent");
    return boardService.deleteProjectAgent(validatedId);
  });
  ipcMain.handle("stella:board:create-squad", (_event, input: unknown) => {
    assertTaskCapability();
    return squadService.create(validatedCreateSquad(input));
  });
  ipcMain.handle("stella:board:update-squad", (_event, input: unknown) => {
    assertTaskCapability();
    return squadService.update(validatedUpdateSquad(input));
  });
  ipcMain.handle("stella:board:delete-squad", (_event, squadId: unknown) => {
    assertTaskCapability();
    return squadService.delete(requiredString(squadId, "squadId"));
  });
  ipcMain.handle("stella:board:create-autopilot", (_event, input: unknown) =>
    createAutopilotForCurrentProject(input),
  );
  ipcMain.handle("stella:board:update-autopilot", (_event, input: unknown) =>
    updateAutopilotForCurrentProject(input),
  );
  ipcMain.handle("stella:board:delete-autopilot", (_event, autopilotId: unknown) =>
    deleteAutopilot(requiredString(autopilotId, "autopilotId")),
  );
  ipcMain.handle("stella:board:trigger-autopilot", (_event, autopilotId: unknown) => {
    assertTaskCapability();
    assertPiExecutionCapability();
    return autopilotService.trigger({ autopilotId: requiredString(autopilotId, "autopilotId"), triggerKind: "manual" });
  });
  ipcMain.handle("stella:board:dispatch-task", (_event, taskId: unknown) =>
    dispatchBoardTask(requiredString(taskId, "taskId")),
  );
  ipcMain.handle("stella:board:resolve-gate", (_event, input: unknown) => {
    assertTaskCapability();
    assertPiExecutionCapability();
    return workflowOrchestrator.resolveGate(validatedGate(input));
  });
  ipcMain.handle("stella:board:review-execution", (_event, input: unknown) => {
    assertTaskCapability();
    return executionReviewService.review(validatedExecutionReview(input));
  });
  ipcMain.handle("stella:board:abort-task", (_event, taskId: unknown) =>
    abortBoardTask(requiredString(taskId, "taskId")),
  );
  ipcMain.handle("stella:board:open-session", (_event, input: unknown) => openTaskSession(input));
  ipcMain.handle("stella:window-action", (_event, action: unknown) => {
    if (!mainWindow) return;
    if (action === "minimize") mainWindow.minimize();
    if (action === "maximize") {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
    if (action === "close") mainWindow.close();
    if (action !== "minimize" && action !== "maximize" && action !== "close") {
      throw new Error(`不支持的窗口操作: ${String(action)}`);
    }
  });
}

function isAllowedAppNavigation(url: string): boolean {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  try {
    const parsed = new URL(url);
    if (devServerUrl) return parsed.origin === new URL(devServerUrl).origin;
    if (parsed.protocol !== "file:") return false;
    const rendererIndexPath = join(dirname(preloadPath), "../renderer/index.html");
    return canonicalSessionPath(fileURLToPath(parsed)) === canonicalSessionPath(rendererIndexPath);
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: "#0c1021",
    title: "Stella · Pi Workbench",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") void shell.openExternal(parsed.toString());
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppNavigation(url)) event.preventDefault();
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isAllowedAppNavigation(url)) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(dirname(preloadPath), "../renderer/index.html"));
  }
}

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    stateStore = new StateStore(join(app.getPath("userData"), "stella-state.json"));
    skinArtworkService = new SkinArtworkService({
      directory: join(app.getPath("userData"), "skin-artwork"),
      storage: Object.freeze({
        mkdir: async (path: string) => { await mkdir(path, { recursive: true }); },
        readFile,
        copyFile,
        readdir: async (path: string) => readdir(path),
        stat,
        remove: async (path: string) => { await rm(path, { force: true }); },
      }),
    });
    registerSkinArtworkProtocol();
    registerIpcHandlers();
    createWindow();
    void initializeTaskCapability();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    dialog.showErrorBox("Stella 启动失败", message);
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let shutdownStarted = false;
let shutdownComplete = false;
app.on("before-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  void Promise.all([runtime.stop(), workflowOrchestrator?.shutdown(), agentTaskRunner?.shutdown(), scheduleRunner?.stop(), webhookServer?.stop()])
    .then(() => {
      interactiveCommandRouter?.release();
      workspaceAdmission.shutdown();
      shutdownComplete = true;
      app.quit();
    })
    .catch((cause: unknown) => {
      interactiveCommandRouter?.release();
      workspaceAdmission.shutdown();
      const message = cause instanceof Error ? cause.stack ?? cause.message : String(cause);
      dialog.showErrorBox("Stella 关闭失败", message);
      shutdownComplete = true;
      app.exit(1);
    });
});

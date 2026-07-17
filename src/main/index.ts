import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  SessionManager,
  hasTrustRequiringProjectResources,
} from "@earendil-works/pi-coding-agent";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
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
import {
  TASK_PRIORITIES,
  type BoardBootstrap,
  type CreateTaskInput,
  type ManualTaskStatus,
  type ResolveGateInput,
  type UpdateTaskInput,
} from "../shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../shared/orchestration-catalog";
import { BoardService } from "./board-service";
import { BoardStore } from "./board-store";
import { PiRpcRuntime } from "./pi-rpc-runtime";
import { StateStore } from "./state-store";
import { WorkflowOrchestrator, type WorkflowRuntimeFactory } from "./workflow-orchestrator";

const rpcEntryPath = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry"));
const preloadPath = fileURLToPath(new URL("../preload/index.cjs", import.meta.url));

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
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} 必须是非空字符串`);
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
let stateStore: StateStore;
let boardStore: BoardStore;
let boardService: BoardService;
let workflowOrchestrator: WorkflowOrchestrator;

function broadcast(source: "pi" | "runtime" | "board", payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("stella:event", { source, payload });
}

const runtime = new PiRpcRuntime({
  executablePath: process.execPath,
  rpcEntryPath,
  spawnProcess: (command, args, options) => spawn(command, [...args], options),
  emitPiEvent: (event) => broadcast("pi", event),
  emitRuntimeSignal: (signal) => broadcast("runtime", signal),
});

const workflowRuntimeFactory: WorkflowRuntimeFactory = Object.freeze({
  create: (callbacks: Parameters<WorkflowRuntimeFactory["create"]>[0]) => new PiRpcRuntime({
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
    workflowId: textValue(input.workflowId, "workflowId"),
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
    workflowId: textValue(input.workflowId, "workflowId"),
  });
}

function validatedManualStatus(value: unknown): ManualTaskStatus {
  if (value !== "planned" && value !== "blocked" && value !== "completed") {
    throw new Error(`不支持的手动任务状态: ${String(value)}`);
  }
  return value;
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

async function createBoardTaskForCurrentProject(value: unknown): Promise<BoardBootstrap> {
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
    sessions: Object.freeze(sessions.map(mapSession)),
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
  if (!currentProject) {
    const persisted = await stateStore.read();
    const cwd = persisted.lastProject ?? (app.isPackaged ? app.getPath("documents") : process.cwd());
    const remembered = persisted.recentProjects.find((project) => project.path === cwd);
    currentProject = Object.freeze({ cwd, trusted: remembered?.trusted ?? false });
  }
  return hydrate();
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
  const path = result.filePaths[0];
  if (result.canceled || !path) return null;
  return Object.freeze({
    path,
    name: basename(path) || path,
    requiresTrust: hasTrustRequiringProjectResources(path),
  });
}

async function openProject(path: string, trusted: boolean): Promise<RuntimeBootstrap> {
  const resolvedPath = resolve(path);
  currentProject = Object.freeze({ cwd: resolvedPath, trusted });
  await runtime.start(currentProject);
  await stateStore.recordProject(resolvedPath, trusted);
  return hydrate();
}

function registerIpcHandlers(): void {
  ipcMain.handle("stella:initialize", () => initializeRuntime());
  ipcMain.handle("stella:refresh", () => hydrate());
  ipcMain.handle("stella:command", (_event, command: unknown) => runtime.send(validatedCommand(command)));
  ipcMain.handle("stella:extension-response", (_event, response: unknown) =>
    runtime.respondToExtension(validatedExtensionResponse(response)),
  );
  ipcMain.handle("stella:choose-project", () => chooseProject());
  ipcMain.handle("stella:open-project", (_event, path: unknown, trusted: unknown) => {
    if (typeof trusted !== "boolean") throw new Error("项目 trusted 参数必须是布尔值");
    return openProject(requiredString(path, "项目路径"), trusted);
  });
  ipcMain.handle("stella:reveal-path", async (_event, path: unknown) => {
    const validatedPath = requiredString(path, "待显示路径");
    const target = await stat(validatedPath);
    if (target.isDirectory()) {
      const error = await shell.openPath(validatedPath);
      if (error) throw new Error(error);
      return;
    }
    shell.showItemInFolder(validatedPath);
  });
  ipcMain.handle("stella:open-external", async (_event, url: unknown) => {
    const parsed = new URL(requiredString(url, "外部链接"));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`不允许打开协议 ${parsed.protocol}`);
    }
    await shell.openExternal(parsed.toString());
  });
  ipcMain.handle("stella:board:initialize", () => boardService.bootstrap());
  ipcMain.handle("stella:board:create-task", (_event, input: unknown) => createBoardTaskForCurrentProject(input));
  ipcMain.handle("stella:board:update-task", (_event, input: unknown) => boardService.updateTask(validatedUpdateTask(input)));
  ipcMain.handle("stella:board:move-task", (_event, taskId: unknown, status: unknown) =>
    boardService.moveTask(requiredString(taskId, "taskId"), validatedManualStatus(status)),
  );
  ipcMain.handle("stella:board:delete-task", (_event, taskId: unknown) =>
    boardService.deleteTask(requiredString(taskId, "taskId")),
  );
  ipcMain.handle("stella:board:dispatch-task", (_event, taskId: unknown) =>
    workflowOrchestrator.dispatch(requiredString(taskId, "taskId")),
  );
  ipcMain.handle("stella:board:resolve-gate", (_event, input: unknown) =>
    workflowOrchestrator.resolveGate(validatedGate(input)),
  );
  ipcMain.handle("stella:board:abort-task", (_event, taskId: unknown) =>
    workflowOrchestrator.abort(requiredString(taskId, "taskId")),
  );
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

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(dirname(preloadPath), "../renderer/index.html"));
  }
}

void app.whenReady().then(async () => {
  stateStore = new StateStore(join(app.getPath("userData"), "stella-state.json"));
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
  });
  registerIpcHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  dialog.showErrorBox("Stella 启动失败", message);
  app.quit();
});

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
  void Promise.all([runtime.stop(), workflowOrchestrator?.shutdown()]).finally(() => {
    shutdownComplete = true;
    app.quit();
  });
});

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  FileOutput,
  FolderOpen,
  GitFork,
  LayoutDashboard,
  ListPlus,
  Menu,
  MessagesSquare,
  Plus,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  TerminalSquare,
  UsersRound,
} from "lucide-react";
import type {
  ModelSummary,
  PiResponse,
  RecentProject,
  SessionSummary,
  SlashCommandSummary,
  StellaDesktopApi,
} from "@shared/contracts";
import type { SkinArtworkDescriptor, SkinId } from "@shared/skin-artwork";
import { AGENT_THINKING_LEVELS, type AgentThinkingLevel } from "@shared/kanban";
import { isReportedRuntimeError, usePiRuntime } from "./hooks/use-pi-runtime";
import { useKanban } from "./hooks/use-kanban";
import { useCapabilities } from "./hooks/use-capabilities";
import { usePreferences } from "./hooks/use-preferences";
import { useSkinArtwork } from "./hooks/use-skin-artwork";
import type { SkinPreference } from "./lib/skins";
import chenxiArtwork from "./assets/skins/chenxi.png";
import dingyangArtwork from "./assets/skins/dingyang.png";
import jojoArtwork from "./assets/skins/jojo.png";
import kuroshitsujiArtwork from "./assets/skins/kuroshitsuji.png";
import qihunArtwork from "./assets/skins/qihun.png";
import xuriArtwork from "./assets/skins/xuri.png";
import yuehuaArtwork from "./assets/skins/yuehua.png";
import { skinDefinition } from "./lib/skins";
import { CommandPalette, type PaletteAction } from "./components/CommandPalette";
import { Composer, type ComposerImage } from "./components/Composer";
import { Conversation } from "./components/Conversation";
import { ExtensionDialog } from "./components/ExtensionDialog";
import { Inspector } from "./components/Inspector";
import { SettingsDialog } from "./components/SettingsDialog";
import { Sidebar, type WorkspaceView } from "./components/Sidebar";
import { TerminalDrawer, type BashResult } from "./components/TerminalDrawer";
import { TextPromptDialog } from "./components/TextPromptDialog";
import { ToastStack } from "./components/ToastStack";
import { Topbar } from "./components/Topbar";
import { WindowControls } from "./components/WindowControls";
import { KanbanWorkspace } from "./features/kanban/KanbanWorkspace";
import { createPiTaskDraft, type PiTaskDraft } from "./features/kanban/pi-task-draft";
import { TeamWorkspace } from "./features/team/TeamWorkspace";
import { ModelConfigurationWorkspace } from "./features/models/ModelConfigurationWorkspace";

interface AppProps {
  readonly api: StellaDesktopApi;
}

function responseData(response: PiResponse): unknown {
  if (!response.success) throw new Error(response.error);
  if (!("data" in response)) throw new Error(`命令 ${response.command} 没有返回数据`);
  return response.data;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function parseBashResult(value: unknown): BashResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Pi 返回了无效的 Bash 结果");
  const record = value as Record<string, unknown>;
  if (
    typeof record.output !== "string" ||
    (typeof record.exitCode !== "number" && record.exitCode !== null) ||
    typeof record.cancelled !== "boolean" ||
    typeof record.truncated !== "boolean"
  ) {
    throw new Error("Pi 返回的 Bash 结果字段不完整");
  }
  return Object.freeze({
    output: record.output,
    exitCode: record.exitCode,
    cancelled: record.cancelled,
    truncated: record.truncated,
    fullOutputPath: typeof record.fullOutputPath === "string" ? record.fullOutputPath : undefined,
  });
}

function exportedPath(value: unknown): string {
  if (typeof value !== "object" || value === null || !("path" in value) || typeof value.path !== "string") {
    throw new Error("Pi 没有返回有效的导出路径");
  }
  return value.path;
}

function wasCancelled(value: unknown, command: string): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Pi 命令 ${command} 没有返回有效的取消状态`);
  }
  const cancelled = (value as Record<string, unknown>).cancelled;
  if (typeof cancelled !== "boolean") throw new Error(`Pi 命令 ${command} 的 cancelled 字段无效`);
  return cancelled;
}

const SKIN_ARTWORK: Readonly<Partial<Record<SkinPreference, string>>> = Object.freeze({
  chenxi: chenxiArtwork,
  dingyang: dingyangArtwork,
  xuri: xuriArtwork,
  yuehua: yuehuaArtwork,
  kuroshitsuji: kuroshitsujiArtwork,
  jojo: jojoArtwork,
  qihun: qihunArtwork,
});

const ARTWORK_IDENTITIES = new Set<SkinPreference>(["xuri", "yuehua", "kuroshitsuji", "jojo", "qihun"]);

function SkinBackdrop({ skin, customArtwork }: { readonly skin: SkinPreference; readonly customArtwork?: SkinArtworkDescriptor }) {
  const artwork = customArtwork?.url ?? SKIN_ARTWORK[skin];
  const definition = skinDefinition(skin);
  return (
    <div className="stellar-backdrop" aria-hidden="true">
      {artwork && <img className={`stellar-backdrop__art stellar-backdrop__art--${skin}`} src={artwork} alt="" />}
      {ARTWORK_IDENTITIES.has(skin) && (
        <span className={`stellar-backdrop__identity stellar-backdrop__identity--${skin}`}>
          <strong>{definition.label}</strong><small>{definition.subtitle}</small>
        </span>
      )}
      <svg viewBox="0 0 1600 900" preserveAspectRatio="none">
        <path className="stellar-backdrop__orbit" d="M-120 240 C 240 40, 490 90, 710 310 S 1220 580, 1710 180" />
        <path className="stellar-backdrop__trail" d="M180 940 C 310 610, 650 690, 830 510 S 1260 120, 1640 380" />
        <g className="stellar-backdrop__stars"><circle cx="365" cy="105" r="2" /><circle cx="709" cy="309" r="3" /><circle cx="1180" cy="500" r="2" /><circle cx="1410" cy="270" r="3" /><circle cx="830" cy="510" r="2" /></g>
      </svg>
    </div>
  );
}

export function App({ api }: AppProps) {
  const controller = usePiRuntime(api);
  const kanban = useKanban(api);
  const capabilities = useCapabilities(api);
  const { state } = controller;
  const [preferences, setPreferences, preferencesStorageError] = usePreferences();
  const skinArtwork = useSkinArtwork(api);
  const [draft, setDraft] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(() => window.innerWidth >= 1280);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [modelChanging, setModelChanging] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("kanban");
  const [createTaskRequest, setCreateTaskRequest] = useState(0);
  const [createTaskDraft, setCreateTaskDraft] = useState<PiTaskDraft>();
  const [queueMode, setQueueMode] = useState<"steer" | "followUp">(
    preferences.defaultQueueMode,
  );
  const appliedRetryPreference = useRef<string | undefined>(undefined);
  const capabilitySnapshot = capabilities.state.snapshot;
  const piHealth = capabilitySnapshot?.pi;
  const taskHealth = capabilitySnapshot?.task;
  const bootstrap = state.bootstrap;
  const piReady = piHealth?.state === "ready" && Boolean(bootstrap);

  const reportActionError = (action: string, cause: unknown) => {
    if (isReportedRuntimeError(cause)) return;
    controller.notify(`${action}失败：${errorMessage(cause)}`, "error");
  };

  const runAction = (action: string, operation: () => Promise<unknown>) => {
    void operation().catch((cause: unknown) => reportActionError(action, cause));
  };

  useEffect(() => {
    if (!skinArtwork.loadError) return;
    controller.notify(`自定义背景加载失败：${skinArtwork.loadError}`, "error");
    skinArtwork.clearLoadError();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- controller/skinArtwork 每次渲染都是新引用；只需在 loadError 变化时提示一次
  }, [skinArtwork.loadError]);

  const runtimeNotify = controller.notify;
  useEffect(() => {
    if (!preferencesStorageError) return;
    runtimeNotify(preferencesStorageError, "error");
  }, [preferencesStorageError, runtimeNotify]);

  const runtimeCommand = controller.command;
  useEffect(() => {
    const bootstrap = state.bootstrap;
    if (state.phase !== "ready" || !bootstrap) return;
    const preferenceKey = `${bootstrap.project.cwd}:${bootstrap.state.sessionId}:${String(preferences.autoRetry)}`;
    if (appliedRetryPreference.current === preferenceKey) return;
    appliedRetryPreference.current = preferenceKey;
    void runtimeCommand({ type: "set_auto_retry", enabled: preferences.autoRetry }).catch(() => {
      if (appliedRetryPreference.current === preferenceKey) appliedRetryPreference.current = undefined;
    });
  }, [runtimeCommand, preferences.autoRetry, state.bootstrap, state.phase]);

  const focusComposer = () => {
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="给 Pi 的消息"]')?.focus(), 0);
  };

  const newSession = async () => {
    if (!bootstrap) {
      controller.notify("Pi Runtime 尚未就绪", "warning");
      return;
    }
    const response = await controller.command({ type: "new_session" }, true);
    if (wasCancelled(responseData(response), "new_session")) {
      controller.notify("新建会话已由 Pi 扩展取消", "warning");
      return;
    }
    setWorkspaceView("chat");
    setDraft("");
    focusComposer();
  };

  const newTask = () => {
    if (!bootstrap) {
      controller.notify("需要先选择一个可用项目，才能新建任务", "warning");
      return;
    }
    setCreateTaskDraft(undefined);
    setWorkspaceView("kanban");
    setCreateTaskRequest((value) => value + 1);
  };

  const solidifyCurrentSession = () => {
    if (!bootstrap) {
      controller.notify("Pi Runtime 尚未就绪，无法读取当前会话", "warning");
      return;
    }
    if (taskHealth?.state !== "ready") {
      controller.notify(`Task Control 不可用：${taskHealth?.error ?? taskHealth?.state ?? "尚未初始化"}`, "error");
      return;
    }
    try {
      setCreateTaskDraft(createPiTaskDraft(bootstrap));
      setWorkspaceView("kanban");
      setCreateTaskRequest((value) => value + 1);
    } catch (cause) {
      controller.notify(cause instanceof Error ? cause.message : String(cause), "error");
    }
  };

  const continueTaskSession = async (taskId: string, sessionPath: string) => {
    await controller.openTaskSession({ taskId, sessionPath });
    setWorkspaceView("chat");
    setSidebarOpen(false);
    controller.notify("已切换到所选任务执行会话", "success");
  };

  const chooseProject = async () => {
    const selection = await controller.chooseProject();
    if (!selection) return;
    await controller.openProject(selection.path, selection.requiresTrust);
  };

  const openRecentProject = async (project: RecentProject) => {
    const opened = await controller.openProject(project.path, project.trusted);
    if (!opened) return;
    setSidebarOpen(false);
  };

  const switchSession = async (session: SessionSummary) => {
    if (session.path === state.bootstrap?.state.sessionFile) return;
    const response = await controller.command({ type: "switch_session", sessionPath: session.path }, true);
    if (wasCancelled(responseData(response), "switch_session")) {
      controller.notify("切换会话已由 Pi 扩展取消", "warning");
      return;
    }
    setWorkspaceView("chat");
    setSidebarOpen(false);
  };

  const setModel = async (model: ModelSummary) => {
    setModelChanging(true);
    try {
      await controller.command({ type: "set_model", provider: model.provider, modelId: model.id }, true);
      controller.notify(`全局模型已切换到 ${model.name}`, "success");
    } catch (cause) {
      reportActionError("切换模型", cause);
    } finally {
      setModelChanging(false);
    }
  };

  const setThinking = async (level: string) => {
    if (!AGENT_THINKING_LEVELS.includes(level as AgentThinkingLevel)) throw new Error(`不支持的思考级别: ${level}`);
    await controller.command({ type: "set_thinking_level", level: level as AgentThinkingLevel }, true);
  };

  const chooseSkinArtwork = async (skin: SkinId) => {
    try {
      const changed = await skinArtwork.choose(skin);
      if (changed) controller.notify(`${skinDefinition(skin).label} 已使用自定义背景`, "success");
    } catch (cause) {
      controller.notify(`更换背景失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
    }
  };

  const resetSkinArtwork = async (skin: SkinId) => {
    try {
      await skinArtwork.reset(skin);
      controller.notify(`${skinDefinition(skin).label} 已恢复内置背景`, "success");
    } catch (cause) {
      controller.notify(`恢复背景失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
    }
  };

  const sendPrompt = async (message: string, images: readonly ComposerImage[]) => {
    const payloadImages = images.map(({ type, data, mimeType }) => ({ type, data, mimeType }));
    await controller.command(
      state.streaming
        ? { type: "prompt", message, images: payloadImages, streamingBehavior: queueMode }
        : { type: "prompt", message, images: payloadImages },
    );
  };

  const fork = async (entryId: string) => {
    const response = await controller.command({ type: "fork", entryId }, true);
    if (wasCancelled(responseData(response), "fork")) {
      controller.notify("创建分支已由 Pi 扩展取消", "warning");
      return;
    }
    controller.notify("已从所选消息创建新分支", "success");
  };

  const cloneSession = async () => {
    const response = await controller.command({ type: "clone" }, true);
    if (wasCancelled(responseData(response), "clone")) {
      controller.notify("克隆会话已由 Pi 扩展取消", "warning");
      return;
    }
    controller.notify("当前分支已克隆为独立会话", "success");
  };

  const compact = async () => {
    await controller.command({ type: "compact" }, true);
    controller.notify("上下文压缩完成", "success");
  };

  const exportSession = async () => {
    const response = await controller.command({ type: "export_html" });
    const path = exportedPath(responseData(response));
    try {
      await api.revealPath(path);
      controller.notify(`会话已导出到 ${path}`, "success");
    } catch (cause) {
      controller.notify(`会话已导出到 ${path}，但无法在文件管理器中显示：${errorMessage(cause)}`, "error");
    }
  };

  const paletteActions = useMemo<readonly PaletteAction[]>(
    () => {
      const actions: PaletteAction[] = [
        { id: "team", label: "打开团队协作", detail: "在 Task Room 中 @lead 或直接委派 Worker", icon: UsersRound, run: () => setWorkspaceView("team") },
        { id: "kanban", label: "打开任务看板", detail: "监督固定 Agent 团队与流程", icon: LayoutDashboard, run: () => setWorkspaceView("kanban") },
        { id: "models", label: "打开模型配置", detail: "连接 Provider、维护自定义模型并选择全局路由", icon: SlidersHorizontal, run: () => setWorkspaceView("models") },
        { id: "project", label: "打开项目", detail: "选择新的本地工作目录", icon: FolderOpen, run: () => runAction("打开项目", chooseProject) },
      ];
      if (!bootstrap) return actions;
      return [
        ...actions,
        { id: "task", label: "新建看板任务", detail: "选择固定流程并分发", icon: Plus, run: newTask },
        { id: "capture-task", label: "固化当前会话为任务", detail: "打开带来源 identity 的可编辑草稿", icon: ListPlus, run: solidifyCurrentSession },
        { id: "chat", label: "返回当前会话", detail: "与 Pi 直接对话", icon: MessagesSquare, run: () => setWorkspaceView("chat") },
        { id: "new", label: "新建会话", detail: "开始一个干净的 Pi 会话", icon: Plus, run: () => runAction("新建会话", newSession) },
        { id: "terminal", label: "运行命令", detail: "打开本地命令抽屉", icon: TerminalSquare, run: () => setTerminalOpen(true) },
        { id: "tree", label: "查看会话图谱", detail: "检查工具活动与分支结构", icon: GitFork, run: () => { setWorkspaceView("chat"); setInspectorOpen(true); } },
        { id: "compact", label: "压缩上下文", detail: "生成摘要并释放模型窗口", icon: Archive, run: () => runAction("压缩上下文", compact) },
        { id: "export", label: "导出 HTML", detail: "保存当前会话记录", icon: FileOutput, run: () => runAction("导出会话", exportSession) },
        { id: "settings", label: "偏好设置", detail: "外观、队列和 Pi 行为", icon: Settings2, run: () => setSettingsOpen(true) },
      ];
    },
    // 动作闭包读取 bootstrap（messages / sessionFile）与 taskHealth，必须随它们重建，否则固化会话用到旧数据。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 动作函数每次渲染重建；只需在 bootstrap/taskHealth 变化时重算，其余依赖会导致 memo 失效
    [bootstrap, taskHealth],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (ctrl && event.key.toLocaleLowerCase() === "n") {
        event.preventDefault();
        if (workspaceView === "kanban" || workspaceView === "team") newTask();
        else runAction("新建会话", newSession);
      }
      if (ctrl && event.key.toLocaleLowerCase() === "l") {
        event.preventDefault();
        if (workspaceView === "kanban") document.querySelector<HTMLInputElement>(".kanban-search input")?.focus();
        else if (workspaceView === "team") document.querySelector<HTMLInputElement>(".team-channel-search input")?.focus();
        else focusComposer();
      }
      if (ctrl && event.key === "`") {
        event.preventDefault();
        setTerminalOpen((value) => !value);
      }
      if (ctrl && event.key.toLocaleLowerCase() === "i") {
        event.preventDefault();
        if (workspaceView !== "chat") {
          setWorkspaceView("chat");
          setInspectorOpen(true);
        } else {
          setInspectorOpen((value) => !value);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // newTask / newSession 闭包读取 bootstrap，必须随 bootstrap 重建，否则快捷键看到过期状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps -- newTask/newSession 每次渲染重建；跟踪 workspaceView/bootstrap 已覆盖闭包读取的全部状态
  }, [workspaceView, bootstrap]);

  return (
    <div className={`app-shell app-shell--${workspaceView} ${workspaceView === "chat" && inspectorOpen ? "has-inspector" : ""} ${terminalOpen ? "has-terminal" : ""}`}>
      <SkinBackdrop skin={preferences.skin} customArtwork={skinArtwork.bySkin[preferences.skin]} />
      <div className="titlebar-drag" />
      <WindowControls api={api} />
      <Sidebar
        bootstrap={bootstrap}
        capabilities={capabilitySnapshot}
        skin={preferences.skin}
        open={sidebarOpen}
        activeView={workspaceView}
        modelChanging={modelChanging}
        onClose={() => setSidebarOpen(false)}
        onNewSession={() => runAction("新建会话", newSession)}
        onNewTask={newTask}
        onSwitchView={(view) => { setWorkspaceView(view); setSidebarOpen(false); }}
        onChooseProject={() => runAction("打开项目", chooseProject)}
        onOpenRecentProject={(project) => runAction("打开最近项目", () => openRecentProject(project))}
        onSwitchSession={(session) => runAction("切换会话", () => switchSession(session))}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenTerminal={() => setTerminalOpen(true)}
        onOpenInspector={() => setInspectorOpen(true)}
        onOpenSettings={() => {
          setSidebarOpen(false);
          setSettingsOpen(true);
        }}
        onModelChange={(model) => void setModel(model)}
      />

      {workspaceView === "chat" && bootstrap && piReady ? <main className="workspace">
        <Topbar
          bootstrap={bootstrap}
          streaming={state.streaming}
          compacting={state.compacting}
          retrying={state.retrying}
          onOpenSidebar={() => setSidebarOpen(true)}
          onToggleInspector={() => setInspectorOpen((value) => !value)}
          onOpenSettings={() => setSettingsOpen(true)}
          onThinkingChange={(level) => runAction("切换思考级别", () => setThinking(level))}
          onAbortRetry={() => runAction("停止自动重试", () => controller.command({ type: "abort_retry" }))}
          onSolidifyTask={solidifyCurrentSession}
        />
        <Conversation
          api={api}
          bootstrap={bootstrap}
          messages={state.messages}
          tools={state.tools}
          streaming={state.streaming}
          onPrefill={(text) => { setDraft(text); focusComposer(); }}
          onFork={(entryId) => runAction("创建会话分支", () => fork(entryId))}
        />
        <Composer
          draft={draft}
          onDraftChange={setDraft}
          editorInjection={state.editorInjection}
          commands={bootstrap.commands}
          widgets={state.extensionWidgets}
          streaming={state.streaming}
          queueMode={queueMode}
          onQueueModeChange={(mode) => {
            setQueueMode(mode);
            setPreferences(Object.freeze({ ...preferences, defaultQueueMode: mode }));
          }}
          onSend={sendPrompt}
          onStop={() => runAction("停止生成", () => controller.command({ type: "abort" }))}
          onOpenTerminal={() => setTerminalOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
          onError={(message) => controller.notify(message, "error")}
        />
      </main> : workspaceView === "chat" ? (
        <main className="workspace capability-workspace">
          <header className="capability-workspace__bar">
            <button type="button" className="icon-button" aria-label="打开侧栏" onClick={() => setSidebarOpen(true)}><Menu size={18} /></button>
            <div><small>PI WORKSPACE</small><strong>{piHealth?.state === "loading" || state.phase === "loading" ? "正在连接" : "连接已中断"}</strong></div>
            <span className={`capability-state capability-state--${piHealth?.state ?? "loading"}`}>{piHealth?.state ?? "loading"}</span>
          </header>
          <section className="capability-workspace__body">
            {piHealth?.state === "loading" || state.phase === "loading" ? <>
              <div className="startup-screen__loader"><span /><span /><span /></div>
              <h1>正在恢复 Pi 工作区</h1>
              <p>任务看板已独立启动，你可以随时切换过去查看历史。</p>
            </> : <>
              <span className="startup-screen__error-mark">!</span>
              <h1>Pi 工作区暂不可用</h1>
              <p>{piHealth?.error ?? state.error ?? capabilities.state.error ?? "初始化没有返回工作区状态。"}</p>
              {state.stderr && <details><summary>查看 Pi 诊断输出</summary><pre>{state.stderr}</pre></details>}
              <div className="capability-workspace__actions">
                <button type="button" className="button-primary" disabled={capabilities.state.retrying.includes("pi")} onClick={() => void capabilities.retry("pi").then((snapshot) => {
                  if (snapshot.pi.state === "ready") void controller.refresh().catch((cause: unknown) => controller.notify(`刷新 Pi 工作区失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"));
                }).catch((cause: unknown) => controller.notify(`重试 Pi 失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"))}><RefreshCw size={15} />{capabilities.state.retrying.includes("pi") ? "正在重试" : "重试 Pi"}</button>
                <button type="button" className="button-secondary" onClick={() => runAction("打开项目", chooseProject)}><FolderOpen size={15} />选择其他项目</button>
                <button type="button" className="button-secondary" onClick={() => setWorkspaceView("kanban")}><LayoutDashboard size={15} />查看任务看板</button>
              </div>
            </>}
          </section>
        </main>
      ) : workspaceView === "models" ? (
        <ModelConfigurationWorkspace
          api={api}
          bootstrap={bootstrap}
          online={piReady}
          modelChanging={modelChanging}
          onOpenSidebar={() => setSidebarOpen(true)}
          onModelChange={setModel}
          onRuntimeRefresh={controller.refresh}
          onNotify={controller.notify}
        />
      ) : workspaceView === "team" ? (
        <TeamWorkspace
          api={api}
          controller={kanban}
          project={bootstrap?.project}
          executionEnabled={piReady}
          onOpenSidebar={() => setSidebarOpen(true)}
          onNewTask={newTask}
          onContinueTaskSession={(taskId, sessionPath) => continueTaskSession(taskId, sessionPath)}
          onError={(message) => controller.notify(message, "error")}
        />
      ) : (
        <KanbanWorkspace
          api={api}
          controller={kanban}
          project={bootstrap?.project}
          executionEnabled={piReady}
          taskCapabilityError={taskHealth?.error}
          taskCapabilityRetrying={capabilities.state.retrying.includes("task")}
          onRetryTaskCapability={() => void capabilities.retry("task").catch((cause: unknown) => controller.notify(`重试 Task Control 失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"))}
          createRequest={createTaskRequest}
          createDraft={createTaskDraft}
          onCreateRequestConsumed={() => setCreateTaskRequest(0)}
          onContinueTaskSession={(taskId, sessionPath) => continueTaskSession(taskId, sessionPath)}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenTerminal={() => setTerminalOpen(true)}
          onError={(message) => controller.notify(message, "error")}
        />
      )}

      {workspaceView === "chat" && bootstrap && piReady && <Inspector
        bootstrap={bootstrap}
        open={inspectorOpen}
        tools={state.tools}
        queue={state.queue}
        extensionStatuses={state.extensionStatuses}
        extensionWidgets={state.extensionWidgets}
        onClose={() => setInspectorOpen(false)}
        onCompact={() => runAction("压缩上下文", compact)}
        onExport={() => runAction("导出会话", exportSession)}
        onClone={() => runAction("克隆会话", cloneSession)}
        onRename={() => setRenameOpen(true)}
        onFork={(entryId) => runAction("创建会话分支", () => fork(entryId))}
      />}

      {bootstrap && piReady && <TerminalDrawer
        open={terminalOpen}
        cwd={bootstrap.project.cwd}
        onClose={() => setTerminalOpen(false)}
        onRun={async (command) => parseBashResult(responseData(await controller.command({ type: "bash", command })))}
        onAbort={async () => {
          try { await controller.command({ type: "abort_bash" }); }
          catch (cause) { reportActionError("停止命令", cause); }
        }}
        onRevealPath={(path) => runAction("显示命令输出", () => api.revealPath(path))}
      />}

      {paletteOpen && (
        <CommandPalette
          commands={bootstrap?.commands ?? []}
          actions={paletteActions}
          onClose={() => setPaletteOpen(false)}
          onInsertCommand={(command: SlashCommandSummary) => { setDraft(`/${command.name} `); focusComposer(); }}
        />
      )}
      {state.extensionRequest && <ExtensionDialog request={state.extensionRequest} onRespond={(response) => void controller.respondToExtension(response).catch((cause: unknown) => controller.notify(`回复扩展请求失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"))} onExpire={controller.expireExtensionRequest} />}
      {renameOpen && bootstrap && <TextPromptDialog title="重命名会话" eyebrow="SESSION NAME" label="会话名称" initialValue={bootstrap.state.sessionName ?? ""} confirmLabel="保存名称" onCancel={() => setRenameOpen(false)} onConfirm={(name) => {
        setRenameOpen(false);
        runAction("重命名会话", () => controller.command({ type: "set_session_name", name }, true));
      }} />}
      {settingsOpen && bootstrap && (
        <SettingsDialog
          bootstrap={bootstrap}
          preferences={preferences}
          customArtwork={skinArtwork.bySkin}
          artworkBusySkin={skinArtwork.busySkin}
          onPreferencesChange={setPreferences}
          onChooseSkinArtwork={(skin) => void chooseSkinArtwork(skin)}
          onResetSkinArtwork={(skin) => void resetSkinArtwork(skin)}
          onAutoCompactionChange={(enabled) => runAction("更新自动压缩设置", () => controller.command({ type: "set_auto_compaction", enabled }, true))}
          onSteeringModeChange={(mode) => runAction("更新 Steering 模式", () => controller.command({ type: "set_steering_mode", mode }, true))}
          onFollowUpModeChange={(mode) => runAction("更新 Follow-up 模式", () => controller.command({ type: "set_follow_up_mode", mode }, true))}
          onRestartTrust={(trusted) => runAction("切换项目信任模式", () => controller.openProject(bootstrap.project.cwd, trusted))}
          onOpenLink={(url) => runAction("打开外部链接", () => api.openExternal(url))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <ToastStack notices={state.notices} onDismiss={controller.dismissNotice} />
    </div>
  );
}

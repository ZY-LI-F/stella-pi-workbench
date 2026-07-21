import { useMemo, useState } from "react";
import {
  ChevronDown,
  CirclePlus,
  Command,
  Folder,
  GitFork,
  LayoutDashboard,
  MessagesSquare,
  SlidersHorizontal,
  PanelLeftClose,
  Search,
  Settings2,
  TerminalSquare,
  UsersRound,
} from "lucide-react";
import type { CapabilityHealthSnapshot, CapabilityName } from "@shared/capabilities";
import type { ModelSummary, RecentProject, RuntimeBootstrap, SessionSummary } from "@shared/contracts";
import type { SkinPreference } from "../lib/skins";
import { Brand } from "./Brand";
import { GlobalModelControl } from "./GlobalModelControl";

interface SidebarProps {
  readonly bootstrap?: RuntimeBootstrap;
  readonly capabilities?: CapabilityHealthSnapshot;
  readonly skin: SkinPreference;
  readonly open: boolean;
  readonly activeView: WorkspaceView;
  readonly modelChanging: boolean;
  readonly onClose: () => void;
  readonly onNewSession: () => void;
  readonly onNewTask: () => void;
  readonly onSwitchView: (view: WorkspaceView) => void;
  readonly onChooseProject: () => void;
  readonly onOpenRecentProject: (project: RecentProject) => void;
  readonly onSwitchSession: (session: SessionSummary) => void;
  readonly onOpenPalette: () => void;
  readonly onOpenTerminal: () => void;
  readonly onOpenInspector: () => void;
  readonly onOpenSettings: () => void;
  readonly onModelChange: (model: ModelSummary) => void;
}

export type WorkspaceView = "chat" | "team" | "kanban" | "models";

const CAPABILITY_LABEL: Readonly<Record<CapabilityName, string>> = Object.freeze({
  pi: "Pi",
  task: "Task",
  schedule: "Schedule",
  webhook: "Webhook",
});

function relativeGroup(dateString: string): "今天" | "过去 7 天" | "更早" {
  const now = new Date();
  const date = new Date(dateString);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startToday) return "今天";
  if (date.getTime() >= startToday - 6 * 24 * 60 * 60 * 1000) return "过去 7 天";
  return "更早";
}

function sessionTitle(session: SessionSummary): string {
  return session.name?.trim() || session.firstMessage.trim() || "未命名会话";
}

function SessionGroup({
  label,
  sessions,
  activePath,
  onSwitch,
}: {
  readonly label: string;
  readonly sessions: readonly SessionSummary[];
  readonly activePath?: string;
  readonly onSwitch: (session: SessionSummary) => void;
}) {
  if (sessions.length === 0) return null;
  return (
    <section className="session-group">
      <h3>{label}</h3>
      <div className="session-group__items">
        {sessions.map((session) => (
          <button
            type="button"
            className={`session-item ${session.path === activePath ? "is-active" : ""}`}
            key={session.path}
            onClick={() => onSwitch(session)}
            title={sessionTitle(session)}
          >
            <span className="session-item__title">{sessionTitle(session)}</span>
            <span className="session-item__meta">
              {session.messageCount} 条消息 · {new Date(session.modified).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function Sidebar({
  bootstrap,
  capabilities,
  skin,
  open,
  activeView,
  modelChanging,
  onClose,
  onNewSession,
  onNewTask,
  onSwitchView,
  onChooseProject,
  onOpenRecentProject,
  onSwitchSession,
  onOpenPalette,
  onOpenTerminal,
  onOpenInspector,
  onOpenSettings,
  onModelChange,
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const groups = useMemo(() => {
    const filtered = (bootstrap?.sessions ?? []).filter((session) =>
      `${sessionTitle(session)} ${session.firstMessage}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
    return {
      今天: filtered.filter((session) => relativeGroup(session.modified) === "今天"),
      "过去 7 天": filtered.filter((session) => relativeGroup(session.modified) === "过去 7 天"),
      更早: filtered.filter((session) => relativeGroup(session.modified) === "更早"),
    };
  }, [bootstrap?.sessions, query]);
  const taskReady = capabilities?.task.state === "ready";
  const piReady = capabilities?.pi.state === "ready" && Boolean(bootstrap);
  const taskSurface = activeView === "kanban" || activeView === "team";
  const primaryActionDisabled = taskSurface ? !taskReady || !bootstrap : !piReady;

  return (
    <>
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <div className="sidebar__brand-row">
          <Brand skin={skin} />
          <button type="button" className="icon-button sidebar__close" aria-label="关闭侧栏" onClick={onClose}>
            <PanelLeftClose size={17} />
          </button>
        </div>

        <button type="button" className="new-session-button" disabled={primaryActionDisabled} onClick={taskSurface ? onNewTask : onNewSession}>
          <CirclePlus size={18} />
          <span>{activeView === "team" ? "新建团队任务" : activeView === "kanban" ? "新建看板任务" : "新建会话"}</span>
          <kbd>Ctrl N</kbd>
        </button>

        <nav className="quick-nav" aria-label="工作区工具">
          <button type="button" className={activeView === "team" ? "is-active" : ""} onClick={() => onSwitchView("team")}>
            <UsersRound size={16} />
            <span>团队协作</span>
          </button>
          <button type="button" className={activeView === "kanban" ? "is-active" : ""} onClick={() => onSwitchView("kanban")}>
            <LayoutDashboard size={16} />
            <span>任务看板</span>
          </button>
          <button type="button" className={activeView === "chat" ? "is-active" : ""} onClick={() => onSwitchView("chat")}>
            <MessagesSquare size={16} />
            <span>当前会话</span>
          </button>
          <button type="button" className={activeView === "models" ? "is-active" : ""} onClick={() => onSwitchView("models")}>
            <SlidersHorizontal size={16} />
            <span>模型配置</span>
          </button>
          <button type="button" onClick={onOpenPalette}>
            <Search size={16} />
            <span>搜索与命令</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button type="button" onClick={onOpenTerminal} disabled={!piReady}>
            <TerminalSquare size={16} />
            <span>运行命令</span>
          </button>
          <button type="button" onClick={onOpenInspector} disabled={!piReady}>
            <GitFork size={16} />
            <span>会话图谱</span>
          </button>
        </nav>

        <GlobalModelControl
          models={bootstrap?.models ?? []}
          selectedModel={bootstrap?.state.model}
          online={piReady}
          busy={modelChanging}
          onChange={onModelChange}
        />

        <div className="project-switcher">
          <button
            type="button"
            className="project-switcher__trigger"
            onClick={() => setProjectMenuOpen((value) => !value)}
            aria-expanded={projectMenuOpen}
          >
            <span className="project-switcher__icon"><Folder size={15} /></span>
            <span className="project-switcher__copy">
              <small>当前项目</small>
              <strong>{bootstrap?.project.name ?? "未连接 Pi"}</strong>
            </span>
            <ChevronDown size={15} />
          </button>
          {projectMenuOpen && (
            <div className="project-menu popover-surface">
              <p className="popover-label">最近项目</p>
              {(bootstrap?.recentProjects ?? []).map((project) => (
                <button
                  type="button"
                  key={project.path}
                  onClick={() => {
                    setProjectMenuOpen(false);
                    onOpenRecentProject(project);
                  }}
                >
                  <Folder size={14} />
                  <span><strong>{project.path.split(/[\\/]/).at(-1)}</strong><small>{project.path}</small></span>
                </button>
              ))}
              {(bootstrap?.recentProjects.length ?? 0) > 0 && <div className="popover-divider" />}
              <button
                type="button"
                onClick={() => {
                  setProjectMenuOpen(false);
                  onChooseProject();
                }}
              >
                <CirclePlus size={14} />
                <span><strong>打开其他项目</strong><small>选择本地文件夹</small></span>
              </button>
            </div>
          )}
        </div>

        {bootstrap ? <>
          <div className="session-search">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选会话" />
            {query && <button type="button" onClick={() => setQuery("")}>清除</button>}
          </div>

          <div className="session-list" aria-label="历史会话">
            <SessionGroup label="今天" sessions={groups["今天"]} activePath={bootstrap.state.sessionFile} onSwitch={onSwitchSession} />
            <SessionGroup label="过去 7 天" sessions={groups["过去 7 天"]} activePath={bootstrap.state.sessionFile} onSwitch={onSwitchSession} />
            <SessionGroup label="更早" sessions={groups["更早"]} activePath={bootstrap.state.sessionFile} onSwitch={onSwitchSession} />
            {bootstrap.sessions.length === 0 && (
              <div className="sidebar-empty"><Command size={19} /><p>这个项目还没有会话。</p></div>
            )}
          </div>
        </> : (
          <div className="sidebar-empty sidebar-empty--capability"><Command size={19} /><p>Pi 会话暂不可用。任务看板保持独立运行。</p></div>
        )}

        <div className="sidebar__footer">
          <button type="button" onClick={onOpenSettings} disabled={!bootstrap}><Settings2 size={16} /><span>偏好设置</span></button>
          <div className="capability-ledger" aria-label="能力状态">
            {(Object.keys(CAPABILITY_LABEL) as CapabilityName[]).map((name) => {
              const health = capabilities?.[name];
              return <span key={name} className={`capability-dot capability-dot--${health?.state ?? "loading"}`} title={`${CAPABILITY_LABEL[name]} · ${health?.state ?? "loading"}${health?.error ? ` · ${health.error}` : ""}`} />;
            })}
          </div>
        </div>
      </aside>
      {open && <button type="button" className="sidebar-scrim" aria-label="关闭侧栏" onClick={onClose} />}
    </>
  );
}

import { useMemo, useState } from "react";
import {
  ChevronDown,
  CirclePlus,
  Command,
  Folder,
  GitFork,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  Search,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import type { RecentProject, RuntimeBootstrap, SessionSummary } from "@shared/contracts";
import type { SkinPreference } from "../lib/skins";
import { Brand } from "./Brand";

interface SidebarProps {
  readonly bootstrap: RuntimeBootstrap;
  readonly skin: SkinPreference;
  readonly open: boolean;
  readonly activeView: WorkspaceView;
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
}

export type WorkspaceView = "chat" | "kanban";

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
  skin,
  open,
  activeView,
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
}: SidebarProps) {
  const [query, setQuery] = useState("");
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const groups = useMemo(() => {
    const filtered = bootstrap.sessions.filter((session) =>
      `${sessionTitle(session)} ${session.firstMessage}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
    return {
      今天: filtered.filter((session) => relativeGroup(session.modified) === "今天"),
      "过去 7 天": filtered.filter((session) => relativeGroup(session.modified) === "过去 7 天"),
      更早: filtered.filter((session) => relativeGroup(session.modified) === "更早"),
    };
  }, [bootstrap.sessions, query]);

  return (
    <>
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <div className="sidebar__brand-row">
          <Brand skin={skin} />
          <button type="button" className="icon-button sidebar__close" aria-label="关闭侧栏" onClick={onClose}>
            <PanelLeftClose size={17} />
          </button>
        </div>

        <button type="button" className="new-session-button" onClick={activeView === "kanban" ? onNewTask : onNewSession}>
          <CirclePlus size={18} />
          <span>{activeView === "kanban" ? "新建看板任务" : "新建会话"}</span>
          <kbd>Ctrl N</kbd>
        </button>

        <nav className="quick-nav" aria-label="工作区工具">
          <button type="button" className={activeView === "kanban" ? "is-active" : ""} onClick={() => onSwitchView("kanban")}>
            <LayoutDashboard size={16} />
            <span>任务看板</span>
          </button>
          <button type="button" className={activeView === "chat" ? "is-active" : ""} onClick={() => onSwitchView("chat")}>
            <MessagesSquare size={16} />
            <span>当前会话</span>
          </button>
          <button type="button" onClick={onOpenPalette}>
            <Search size={16} />
            <span>搜索与命令</span>
            <kbd>Ctrl K</kbd>
          </button>
          <button type="button" onClick={onOpenTerminal}>
            <TerminalSquare size={16} />
            <span>运行命令</span>
          </button>
          <button type="button" onClick={onOpenInspector}>
            <GitFork size={16} />
            <span>会话图谱</span>
          </button>
        </nav>

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
              <strong>{bootstrap.project.name}</strong>
            </span>
            <ChevronDown size={15} />
          </button>
          {projectMenuOpen && (
            <div className="project-menu popover-surface">
              <p className="popover-label">最近项目</p>
              {bootstrap.recentProjects.map((project) => (
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
              {bootstrap.recentProjects.length > 0 && <div className="popover-divider" />}
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

        <div className="sidebar__footer">
          <button type="button" onClick={onOpenSettings}><Settings2 size={16} /><span>偏好设置</span></button>
          <span className="runtime-dot" title="Pi RPC 已连接" />
        </div>
      </aside>
      {open && <button type="button" className="sidebar-scrim" aria-label="关闭侧栏" onClick={onClose} />}
    </>
  );
}

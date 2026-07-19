import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Bot, CircleDot, Hash, Menu, MessageSquarePlus, Orbit, Pencil, Plus, Search, Sparkles, UsersRound } from "lucide-react";
import type { ProjectMeta, StellaDesktopApi } from "@shared/contracts";
import { deriveAgentPresences } from "@shared/agent-presence";
import { availableMentionAgentsForTask } from "@shared/agent-mentions";
import type { ProjectAgentDefinition } from "@shared/kanban";
import type { KanbanController } from "../../hooks/use-kanban";
import { AGENT_PRESENCE_LABEL, STAGE_LABEL, formatRelativeTime } from "../kanban/kanban-format";
import { TaskDetailPanel } from "../kanban/TaskDetailPanel";
import type { AgentMentionRequest } from "../kanban/AgentMentionInput";
import { TaskEditorDialog } from "../kanban/TaskEditorDialog";
import { AgentDraftDialog } from "./AgentDraftDialog";
import { TeamLaunchRoom } from "./TeamLaunchRoom";

const TEAM_LAUNCH_ROOM_ID = "project-launch-room";

interface TeamWorkspaceProps {
  readonly api: StellaDesktopApi;
  readonly controller: KanbanController;
  readonly project?: ProjectMeta;
  readonly executionEnabled: boolean;
  readonly onOpenSidebar: () => void;
  readonly onNewTask: () => void;
  readonly onContinueTaskSession: (taskId: string, sessionPath: string) => Promise<void>;
  readonly onError: (message: string) => void;
}

export function TeamWorkspace({ api, controller, project, executionEnabled, onOpenSidebar, onNewTask, onContinueTaskSession, onError }: TeamWorkspaceProps) {
  const { state } = controller;
  const [query, setQuery] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState(TEAM_LAUNCH_ROOM_ID);
  const [agentDraft, setAgentDraft] = useState<ProjectAgentDefinition | "new">();
  const [editingTask, setEditingTask] = useState(false);
  const [localError, setLocalError] = useState("");
  const [mentionRequest, setMentionRequest] = useState<AgentMentionRequest>();
  const mentionRequestSequence = useRef(0);
  const bootstrap = state.bootstrap;
  const board = bootstrap?.board;
  const catalog = bootstrap?.catalog;

  const tasks = useMemo(() => {
    if (!board) return [];
    const normalized = query.trim().toLocaleLowerCase();
    return board.tasks
      .filter((task) => !project || task.projectPath === project.cwd)
      .filter((task) => !normalized || `${task.title} ${task.description} ${task.acceptanceCriteria}`.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => Number(Boolean(right.activeRunId || right.activeAgentTaskId)) - Number(Boolean(left.activeRunId || left.activeAgentTaskId)) || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [board, project, query]);

  useEffect(() => {
    if (selectedChannelId === TEAM_LAUNCH_ROOM_ID || tasks.some((task) => task.id === selectedChannelId)) return;
    setSelectedChannelId(TEAM_LAUNCH_ROOM_ID);
  }, [selectedChannelId, tasks]);

  useEffect(() => setMentionRequest(undefined), [selectedChannelId]);

  if (!bootstrap || !board || !catalog) {
    return <main className="team-workspace team-workspace--loading"><div className="kanban-loading-orbit"><span /><span /><span /></div><h1>正在连接团队中继</h1><p>{state.error ?? "读取 Task Room 与 Agent Presence。"}</p></main>;
  }

  const selectedTask = selectedChannelId === TEAM_LAUNCH_ROOM_ID ? undefined : board.tasks.find((task) => task.id === selectedChannelId);
  const taskRuns = selectedTask ? board.runs.filter((run) => run.taskId === selectedTask.id) : [];
  const taskActivities = selectedTask ? board.activities.filter((activity) => activity.taskId === selectedTask.id) : [];
  const taskAgentTasks = selectedTask ? board.agentTasks.filter((agentTask) => agentTask.taskId === selectedTask.id) : [];
  const taskComments = selectedTask ? board.comments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const presences = deriveAgentPresences(board, catalog, project?.cwd);
  const lead = catalog.agents.find((agent) => agent.id === "lead");
  const mentionableAgentIds = new Set(selectedTask ? availableMentionAgentsForTask(selectedTask, catalog, board.squads).map((agent) => agent.id) : []);
  const busy = selectedTask ? state.pending.includes(selectedTask.id) : false;
  const selectedTaskMentionBlock = selectedTask?.activeRunId || selectedTask?.activeAgentTaskId
    ? "当前任务正在执行"
    : selectedTask?.stage === "completed"
      ? "已完成任务需先移回待规划"
      : undefined;

  const perform = async <T,>(action: () => Promise<T>): Promise<T> => {
    setLocalError("");
    try { return await action(); } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setLocalError(message);
      onError(message);
      throw cause;
    }
  };

  const launchFromRoom = async (body: string): Promise<void> => {
    const existingTaskIds = new Set(board.tasks.map((task) => task.id));
    setLocalError("");
    try {
      const next = await controller.launchTeamTask(Object.freeze({ body }));
      const created = next.board.tasks[0];
      if (!created || existingTaskIds.has(created.id)) throw new Error("团队启动事务没有返回新任务");
      setQuery("");
      setSelectedChannelId(created.id);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    }
  };

  return (
    <main className="team-workspace">
      <header className="team-header">
        <div className="team-header__identity"><button type="button" className="icon-button" aria-label="打开侧栏" onClick={onOpenSidebar}><Menu size={18} /></button><span className="team-header__mark"><UsersRound size={19} /><i /></span><div><small>STELLA TEAM RELAY</small><h1>团队协作</h1></div><em>Stella</em></div>
        <div className="team-header__status"><span><i className={executionEnabled ? "is-live" : ""} />{executionEnabled ? "PI RUNTIME ONLINE" : "BOARD ONLY"}</span><button type="button" className="button-primary" onClick={onNewTask}><Plus size={14} />新建任务</button></div>
      </header>

      <div className="team-grid">
        <aside className="team-channels" aria-label="任务频道">
          <header><div><small>TEAM ROOMS</small><h2>协作频道</h2></div><span>{tasks.length + 1}</span></header>
          <div className="team-channel-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索已创建任务" aria-label="搜索已创建任务" /></div>
          <div className="team-channel-list">
            <button type="button" className={`team-channel--launch ${selectedChannelId === TEAM_LAUNCH_ROOM_ID ? "is-active" : ""}`} onClick={() => setSelectedChannelId(TEAM_LAUNCH_ROOM_ID)}><span className="team-channel__hash team-channel__launch-mark"><Orbit size={13} /><i /></span><span><strong>项目启动室</strong><small>@LEAD 创建并接管新任务</small></span><time>常驻</time></button>
            <div className="team-channel-list__divider"><span>任务频道</span><b>{tasks.length}</b></div>
            {tasks.map((task) => {
              const messages = board.comments.filter((comment) => comment.taskId === task.id).length;
              const active = Boolean(task.activeRunId || task.activeAgentTaskId);
              return <button type="button" key={task.id} className={task.id === selectedChannelId ? "is-active" : ""} onClick={() => setSelectedChannelId(task.id)}><span className="team-channel__hash"><Hash size={13} />{active && <i />}</span><span><strong>{task.title}</strong><small>{STAGE_LABEL[task.stage]} · {messages} 条消息</small></span><time>{formatRelativeTime(task.updatedAt)}</time></button>;
            })}
            {tasks.length === 0 && <div className="team-empty"><MessageSquarePlus size={20} /><strong>还没有任务频道</strong><p>在上方项目启动室向 @LEAD 说明目标，第一条消息会直接成为任务。</p></div>}
          </div>
        </aside>

        <section className="team-conversation" aria-label="团队对话">
          {selectedTask ? <TaskDetailPanel
            variant="workspace"
            task={selectedTask}
            catalog={catalog}
            squads={board.squads}
            runs={taskRuns}
            agentTasks={taskAgentTasks}
            comments={taskComments}
            activities={taskActivities}
            busy={busy}
            executionEnabled={executionEnabled}
            onClose={() => undefined}
            onEdit={() => setEditingTask(true)}
            onDispatch={() => perform(() => controller.dispatchTask(selectedTask.id)).then(() => undefined)}
            onAbort={() => perform(() => controller.abortTask(selectedTask.id)).then(() => undefined)}
            onDelete={() => perform(() => controller.deleteTask(selectedTask.id)).then(() => setSelectedChannelId(TEAM_LAUNCH_ROOM_ID))}
            onAddComment={(body) => perform(() => controller.addComment({ taskId: selectedTask.id, body })).then(() => undefined)}
            onMove={(stage) => perform(() => controller.moveTask(selectedTask.id, stage)).then(() => undefined)}
            onResolveGate={(input) => perform(() => controller.resolveGate(input)).then(() => undefined)}
            onReviewExecution={(input) => perform(() => controller.reviewExecution(input)).then(() => undefined)}
            onRevealPath={(path) => void api.revealPath(path)}
            onContinueInPi={(sessionPath) => onContinueTaskSession(selectedTask.id, sessionPath)}
            agentPresences={presences}
            mentionRequest={mentionRequest}
          /> : <TeamLaunchRoom
            project={project}
            lead={lead}
            presences={presences}
            mentionRequest={mentionRequest}
            busy={state.pending.includes("team:launch")}
            executionEnabled={executionEnabled}
            onLaunch={launchFromRoom}
          />}
          {localError && <p className="team-workspace__error" role="alert">{localError}</p>}
        </section>

        <aside className="team-pulse" aria-label="Agent Presence">
          <header><div><small>TEAM PULSE</small><h2>星队状态</h2></div><span className="team-pulse__orbit"><i /><b /><Sparkles size={13} /></span></header>
          <div className="team-pulse__legend"><span><i className="running" />执行</span><span><i className="waiting" />等待</span><span><i className="available" />可用</span></div>
          <div className="team-pulse__list">
            {presences.map((presence, index) => {
              const scoped = presence.agent as Partial<ProjectAgentDefinition>;
              const membershipBlock = selectedTask && !mentionableAgentIds.has(presence.agent.id) ? "不属于当前 Task Room 的可 @ 范围" : undefined;
              const mentionBlock = selectedTask
                ? selectedTaskMentionBlock ?? membershipBlock
                : !project
                  ? "请先打开一个项目"
                  : !executionEnabled
                    ? "Pi Runtime 尚未就绪"
                    : presence.agent.id === "lead"
                      ? undefined
                      : "项目启动室只允许 @LEAD 创建任务";
              return <article key={presence.agent.id} className={`agent-presence agent-presence--${presence.state}`} style={{ "--orbit-index": index } as CSSProperties}>
                <button type="button" className="agent-presence__mention" disabled={Boolean(mentionBlock)} title={mentionBlock} aria-label={`${selectedTask ? "在 Task Room" : "在项目启动室"} @${presence.agent.name}`} onClick={() => {
                  setLocalError("");
                  mentionRequestSequence.current += 1;
                  setMentionRequest(Object.freeze({ requestId: mentionRequestSequence.current, agentId: presence.agent.id }));
                }}>
                  <span className="agent-presence__avatar"><Bot size={14} /><i /></span>
                  <span className="agent-presence__identity"><strong>{presence.agent.name}</strong><small>@{presence.agent.callsign} · {presence.detail}</small>{presence.activeTaskTitle && <em>{presence.activeTaskTitle}</em>}</span>
                  <span className="agent-presence__state"><b>{AGENT_PRESENCE_LABEL[presence.state]}</b><small>{presence.workload > 0 ? `${presence.workload} 个任务` : `@${presence.agent.callsign}`}</small></span>
                </button>
                {scoped.projectPath && <button type="button" className="agent-presence__edit" aria-label={`编辑 ${presence.agent.name}`} onClick={() => setAgentDraft(scoped as ProjectAgentDefinition)}><Pencil size={11} /></button>}
              </article>;
            })}
          </div>
          <footer><button type="button" className="button-secondary" disabled={!project} onClick={() => setAgentDraft("new")}><Plus size={13} />创建 Agent</button><small><CircleDot size={10} />状态来自 Workflow / AgentTask，不手工维护</small></footer>
        </aside>
      </div>

      {agentDraft && project && <AgentDraftDialog
        project={project}
        agent={agentDraft === "new" ? undefined : agentDraft}
        busy={state.pending.includes("agent:create") || (agentDraft !== "new" && state.pending.includes(`agent:${agentDraft.id}`))}
        onClose={() => setAgentDraft(undefined)}
        onCreate={(input) => controller.createAgent(input).then(() => undefined)}
        onUpdate={(input) => controller.updateAgent(input).then(() => undefined)}
        onDelete={(agentId) => controller.deleteAgent(agentId).then(() => undefined)}
      />}
      {editingTask && selectedTask && <TaskEditorDialog
        task={selectedTask}
        project={Object.freeze({ cwd: selectedTask.projectPath, name: selectedTask.projectName, trusted: selectedTask.trusted, requiresTrust: false })}
        workflows={catalog.workflows}
        agents={catalog.agents.filter((agent) => !("projectPath" in agent) || (agent as ProjectAgentDefinition).projectPath === selectedTask.projectPath)}
        squads={board.squads}
        busy={state.pending.includes(selectedTask.id)}
        onClose={() => setEditingTask(false)}
        onCreate={(input) => controller.createTask(input).then(() => undefined)}
        onUpdate={(input) => controller.updateTask(input).then(() => undefined)}
      />}
    </main>
  );
}

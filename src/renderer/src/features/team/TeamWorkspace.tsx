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
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
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
    if (selectedTaskId && tasks.some((task) => task.id === selectedTaskId)) return;
    setSelectedTaskId(tasks[0]?.id);
  }, [selectedTaskId, tasks]);

  useEffect(() => setMentionRequest(undefined), [selectedTaskId]);

  if (!bootstrap || !board || !catalog) {
    return <main className="team-workspace team-workspace--loading"><div className="kanban-loading-orbit"><span /><span /><span /></div><h1>正在连接团队中继</h1><p>{state.error ?? "读取 Task Room 与 Agent Presence。"}</p></main>;
  }

  const selectedTask = board.tasks.find((task) => task.id === selectedTaskId);
  const taskRuns = selectedTask ? board.runs.filter((run) => run.taskId === selectedTask.id) : [];
  const taskActivities = selectedTask ? board.activities.filter((activity) => activity.taskId === selectedTask.id) : [];
  const taskAgentTasks = selectedTask ? board.agentTasks.filter((agentTask) => agentTask.taskId === selectedTask.id) : [];
  const taskComments = selectedTask ? board.comments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const presences = deriveAgentPresences(board, catalog, project?.cwd);
  const mentionableAgentIds = new Set(selectedTask ? availableMentionAgentsForTask(selectedTask, catalog, board.squads).map((agent) => agent.id) : []);
  const busy = selectedTask ? state.pending.includes(selectedTask.id) : false;
  const selectedTaskMentionBlock = selectedTask?.activeRunId || selectedTask?.activeAgentTaskId
    ? "当前任务正在执行"
    : selectedTask?.stage === "completed"
      ? "已完成任务需先移回待规划"
      : undefined;

  const perform = async (action: () => Promise<unknown>) => {
    setLocalError("");
    try { await action(); } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setLocalError(message);
      onError(message);
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
          <header><div><small>TASK CHANNELS</small><h2>任务频道</h2></div><span>{tasks.length}</span></header>
          <div className="team-channel-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Task Room" /></div>
          <div className="team-channel-list">
            {tasks.map((task) => {
              const messages = board.comments.filter((comment) => comment.taskId === task.id).length;
              const active = Boolean(task.activeRunId || task.activeAgentTaskId);
              return <button type="button" key={task.id} className={task.id === selectedTaskId ? "is-active" : ""} onClick={() => setSelectedTaskId(task.id)}><span className="team-channel__hash"><Hash size={13} />{active && <i />}</span><span><strong>{task.title}</strong><small>{STAGE_LABEL[task.stage]} · {messages} 条消息</small></span><time>{formatRelativeTime(task.updatedAt)}</time></button>;
            })}
            {tasks.length === 0 && <div className="team-empty"><MessageSquarePlus size={20} /><strong>还没有任务频道</strong><p>创建任务后，Task Room 会自动成为团队频道。</p><button type="button" className="button-secondary" onClick={onNewTask}>创建第一个任务</button></div>}
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
            onDelete={() => perform(() => controller.deleteTask(selectedTask.id)).then(() => setSelectedTaskId(undefined))}
            onAddComment={(body) => perform(() => controller.addComment({ taskId: selectedTask.id, body })).then(() => undefined)}
            onMove={(stage) => perform(() => controller.moveTask(selectedTask.id, stage)).then(() => undefined)}
            onResolveGate={(input) => perform(() => controller.resolveGate(input)).then(() => undefined)}
            onReviewExecution={(input) => perform(() => controller.reviewExecution(input)).then(() => undefined)}
            onRevealPath={(path) => void api.revealPath(path)}
            onContinueInPi={(sessionPath) => onContinueTaskSession(selectedTask.id, sessionPath)}
            agentPresences={presences}
            mentionRequest={mentionRequest}
          /> : <div className="team-conversation__empty"><Orbit size={34} /><small>TEAM RELAY</small><h2>选择一个任务频道</h2><p>在这里与 @lead 或指定 Worker 对话，所有分发、报告和验收仍写入同一条 Task Room 事实流。</p></div>}
          {localError && <p className="team-workspace__error" role="alert">{localError}</p>}
        </section>

        <aside className="team-pulse" aria-label="Agent Presence">
          <header><div><small>TEAM PULSE</small><h2>星队状态</h2></div><span className="team-pulse__orbit"><i /><b /><Sparkles size={13} /></span></header>
          <div className="team-pulse__legend"><span><i className="running" />执行</span><span><i className="waiting" />等待</span><span><i className="available" />可用</span></div>
          <div className="team-pulse__list">
            {presences.map((presence, index) => {
              const scoped = presence.agent as Partial<ProjectAgentDefinition>;
              const membershipBlock = selectedTask && !mentionableAgentIds.has(presence.agent.id) ? "不属于当前 Task Room 的可 @ 范围" : undefined;
              const mentionBlock = !selectedTask ? "请先选择任务频道" : selectedTaskMentionBlock ?? membershipBlock;
              return <article key={presence.agent.id} className={`agent-presence agent-presence--${presence.state}`} style={{ "--orbit-index": index } as CSSProperties}>
                <button type="button" className="agent-presence__mention" disabled={Boolean(mentionBlock)} title={mentionBlock} aria-label={`在 Task Room @${presence.agent.name}`} onClick={() => {
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

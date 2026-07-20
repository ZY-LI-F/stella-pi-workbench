import { useEffect, useMemo, useState, type DragEvent } from "react";
import {
  Bot,
  ChevronDown,
  FolderKanban,
  Menu,
  Plus,
  Search,
  TerminalSquare,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import type { ProjectMeta, StellaDesktopApi } from "@shared/contracts";
import { deriveAgentPresences } from "@shared/agent-presence";
import {
  MANUAL_TASK_STAGES,
  type BoardLane,
  type KanbanTask,
  type ManualTaskStage,
  type OrchestrationCatalog,
  type ProjectAgentDefinition,
  type Squad,
  type WorkflowDefinition,
} from "@shared/kanban";
import type { KanbanController } from "../../hooks/use-kanban";
import { CatalogDialog } from "./CatalogDialog";
import { AutomationStudioDialog } from "./AutomationStudioDialog";
import { LANE_CONFIG } from "./kanban-format";
import { TaskCard } from "./TaskCard";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { TaskEditorDialog } from "./TaskEditorDialog";
import type { PiTaskDraft } from "./pi-task-draft";

interface KanbanWorkspaceProps {
  readonly api: StellaDesktopApi;
  readonly controller: KanbanController;
  readonly project?: ProjectMeta;
  readonly executionEnabled: boolean;
  readonly taskCapabilityError?: string;
  readonly taskCapabilityRetrying: boolean;
  readonly onRetryTaskCapability: () => void;
  readonly createRequest: number;
  readonly createDraft?: PiTaskDraft;
  readonly onCreateRequestConsumed: () => void;
  readonly onContinueTaskSession: (taskId: string, sessionPath: string) => Promise<void>;
  readonly onOpenSidebar: () => void;
  readonly onOpenTerminal: () => void;
  readonly onError: (message: string) => void;
}

const MANUAL_LANES = new Set<BoardLane>(MANUAL_TASK_STAGES);
const PRIORITY_ORDER: Readonly<Record<KanbanTask["priority"], number>> = Object.freeze({
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
});

function workflowForTask(task: KanbanTask, catalog: OrchestrationCatalog): WorkflowDefinition | undefined {
  const target = task.executionTarget;
  return target.kind === "workflow" ? catalog.workflows.find((workflow) => workflow.id === target.workflowId) : undefined;
}

function executionLabelForTask(task: KanbanTask, catalog: OrchestrationCatalog, squads: readonly Squad[]): string {
  const target = task.executionTarget;
  if (target.kind === "workflow") return catalog.workflows.find((workflow) => workflow.id === target.workflowId)?.shortName ?? target.workflowId;
  if (target.kind === "agent") return catalog.agents.find((agent) => agent.id === target.agentId)?.name ?? target.agentId;
  return squads.find((squad) => squad.id === target.squadId)?.name ?? target.squadId;
}

export function KanbanWorkspace({
  api,
  controller,
  project,
  executionEnabled,
  taskCapabilityError,
  taskCapabilityRetrying,
  onRetryTaskCapability,
  createRequest,
  createDraft,
  onCreateRequestConsumed,
  onContinueTaskSession,
  onOpenSidebar,
  onOpenTerminal,
  onError,
}: KanbanWorkspaceProps) {
  const { state } = controller;
  const [query, setQuery] = useState("");
  const [projectScope, setProjectScope] = useState<"current" | "all">(project ? "current" : "all");
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [editorTaskId, setEditorTaskId] = useState<string | "new">();
  const [newTaskDraft, setNewTaskDraft] = useState<PiTaskDraft>();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);

  // 打开编辑器后立即消费请求计数，避免 project 变化或组件重挂载时重新弹出幽灵对话框。
  useEffect(() => {
    if (createRequest > 0 && project) {
      onCreateRequestConsumed();
      setNewTaskDraft(createDraft);
      setEditorTaskId("new");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- createRequest 一次性消费；onCreateRequestConsumed 是父级内联回调，加入依赖会导致每次渲染重复消费
  }, [createDraft, createRequest, project]);

  useEffect(() => {
    if (!project) setProjectScope("all");
  }, [project]);

  const bootstrap = state.bootstrap;
  const board = bootstrap?.board;
  const catalog = bootstrap?.catalog;
  const selectedTask = board?.tasks.find((task) => task.id === selectedTaskId);
  const editorTask = editorTaskId && editorTaskId !== "new"
    ? board?.tasks.find((task) => task.id === editorTaskId)
    : undefined;
  const editorProject: ProjectMeta | undefined = editorTask ? Object.freeze({
    cwd: editorTask.projectPath,
    name: editorTask.projectName,
    trusted: editorTask.trusted,
    requiresTrust: false,
  }) : project;

  useEffect(() => {
    if (selectedTaskId && board && !board.tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(undefined);
  }, [board, selectedTaskId]);

  const visibleTasks = useMemo(() => {
    if (!board) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return board.tasks
      .filter((task) => projectScope === "all" || task.projectPath === project?.cwd)
      .filter((task) => workflowFilter === "all" || (task.executionTarget.kind === "workflow" && task.executionTarget.workflowId === workflowFilter))
      .filter((task) => !normalizedQuery || `${task.title} ${task.description} ${task.acceptanceCriteria} ${task.projectName}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [board, project?.cwd, projectScope, query, workflowFilter]);

  const report = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    onError(message);
  };

  const dispatch = async (taskId: string) => {
    try {
      await controller.dispatchTask(taskId);
    } catch (cause) {
      report(cause);
      throw cause;
    }
  };

  const move = async (taskId: string, stage: ManualTaskStage) => {
    try {
      await controller.moveTask(taskId, stage);
    } catch (cause) {
      report(cause);
      throw cause;
    }
  };

  const dropTask = (event: DragEvent<HTMLElement>, lane: BoardLane) => {
    event.preventDefault();
    if (!MANUAL_LANES.has(lane)) return;
    const taskId = event.dataTransfer.getData("application/x-stella-task");
    if (!taskId) return;
    void move(taskId, lane as ManualTaskStage).catch(() => undefined);
  };

  if (state.phase === "error" && (!bootstrap || !board || !catalog)) {
    return (
      <main className="kanban-workspace kanban-workspace--error">
        <FolderKanban size={30} />
        <h1>看板没有加载成功</h1>
        <p>{taskCapabilityError ?? state.error}</p>
        <button type="button" className="button-primary" disabled={taskCapabilityRetrying} onClick={onRetryTaskCapability}>
          {taskCapabilityRetrying ? "正在重试" : "重试 Task Control"}
        </button>
      </main>
    );
  }

  if (state.phase === "loading" || !bootstrap || !board || !catalog) {
    return (
      <main className="kanban-workspace kanban-workspace--loading">
        <div className="kanban-loading-orbit"><span /><span /><span /></div>
        <h1>正在恢复任务星图</h1>
        <p>读取流程、Agent 与历史产物。</p>
      </main>
    );
  }

  const taskRuns = (taskId: string) => board.runs.filter((run) => run.taskId === taskId);
  const taskActivities = (taskId: string) => board.activities.filter((activity) => activity.taskId === taskId);
  const taskAgentTasks = (taskId: string) => board.agentTasks.filter((agentTask) => agentTask.taskId === taskId);
  const taskComments = (taskId: string) => board.comments.filter((comment) => comment.taskId === taskId);

  return (
    <main className={`kanban-workspace ${selectedTask ? "has-detail" : ""}`}>
      <header className="kanban-header">
        <div className="kanban-header__identity">
          <button type="button" className="icon-button kanban-menu" aria-label="打开侧栏" onClick={onOpenSidebar}><Menu size={18} /></button>
          <span className="kanban-header__mark"><FolderKanban size={19} /><i /></span>
          <div><small>STELLA MISSION BOARD</small><h1>任务星图</h1></div>
          <em>Stella</em>
        </div>
        <div className="kanban-header__actions">
          <button type="button" className="button-secondary" onClick={() => setCatalogOpen(true)}><Users size={15} />编排目录</button>
          <button type="button" className="button-secondary" disabled={!project} onClick={() => setAutomationOpen(true)}><Zap size={15} />自动化</button>
          <button type="button" className="icon-button" disabled={!project} aria-label="打开命令终端" onClick={onOpenTerminal}><TerminalSquare size={16} /></button>
          <button type="button" className="button-primary" disabled={!project} onClick={() => { setNewTaskDraft(undefined); setEditorTaskId("new"); }}><Plus size={15} />新建任务</button>
        </div>
      </header>

      <div className="kanban-controls">
        <div className="kanban-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、说明或验收标准" />{query && <button type="button" onClick={() => setQuery("")}>清除</button>}</div>
        <label className="kanban-select"><span>项目</span><select value={projectScope} disabled={!project} onChange={(event) => setProjectScope(event.target.value as "current" | "all")}>{project && <option value="current">{project.name}</option>}<option value="all">全部项目</option></select><ChevronDown size={13} /></label>
        <label className="kanban-select"><Workflow size={13} /><select value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value)}><option value="all">全部流程</option>{catalog.workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.shortName}</option>)}</select><ChevronDown size={13} /></label>
        <span className="kanban-controls__count">显示 {visibleTasks.length} / {board.tasks.length} 项</span>
      </div>

      {state.error && <div className="kanban-inline-error" role="alert">{state.error}</div>}

      <div className="kanban-stage">
        <div className="kanban-board" aria-label="任务看板">
          {LANE_CONFIG.map((lane) => {
            const tasks = visibleTasks.filter((task) => task.stage === lane.id);
            return (
              <section
                className={`kanban-lane kanban-lane--${lane.id} ${MANUAL_LANES.has(lane.id) ? "is-droppable" : ""}`}
                key={lane.id}
                onDragOver={(event) => { if (MANUAL_LANES.has(lane.id)) event.preventDefault(); }}
                onDrop={(event) => dropTask(event, lane.id)}
              >
                <header className="kanban-lane__header">
                  <div><i /><span><small>{lane.code}</small><strong>{lane.label}</strong></span></div>
                  <b>{tasks.length}</b>
                </header>
                <div className="kanban-lane__body">
                  {tasks.map((task) => {
                    const runs = taskRuns(task.id);
                    const run = runs.find((candidate) => candidate.id === task.activeRunId) ?? runs[0];
                    const agentTasks = taskAgentTasks(task.id);
                    const agentTask = agentTasks.find((candidate) => candidate.id === task.activeAgentTaskId)
                      ?? [...agentTasks].reverse().find((candidate) => !candidate.parentAgentTaskId);
                    const workflow = workflowForTask(task, catalog);
                    return (
                      <TaskCard
                        key={task.id}
                        task={task}
                        workflow={workflow}
                        executionLabel={executionLabelForTask(task, catalog, board.squads)}
                        run={run}
                        agentTask={agentTask}
                        activities={taskActivities(task.id)}
                        liveEvent={task.activeRunId && run ? state.liveEvents[run.id] : undefined}
                        liveAgentTaskEvent={agentTask ? state.liveAgentTaskEvents[agentTask.id] : undefined}
                        busy={state.pending.includes(task.id)}
                        executionEnabled={executionEnabled}
                        onOpen={() => setSelectedTaskId(task.id)}
                        onDispatch={() => void dispatch(task.id).catch(() => undefined)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("application/x-stella-task", task.id);
                        }}
                      />
                    );
                  })}
                  {tasks.length === 0 && <div className="kanban-lane__empty"><span /><p>{lane.empty}</p></div>}
                </div>
              </section>
            );
          })}
        </div>

        {selectedTask && (
          <TaskDetailPanel
            key={selectedTask.id}
            task={selectedTask}
            catalog={catalog}
            squads={board.squads}
            runs={taskRuns(selectedTask.id)}
            agentTasks={taskAgentTasks(selectedTask.id)}
            comments={taskComments(selectedTask.id)}
            activities={taskActivities(selectedTask.id)}
            busy={state.pending.includes(selectedTask.id)}
            executionEnabled={executionEnabled}
            onClose={() => setSelectedTaskId(undefined)}
            onEdit={() => setEditorTaskId(selectedTask.id)}
            onDispatch={() => dispatch(selectedTask.id)}
            onAbort={async () => {
              try { await controller.abortTask(selectedTask.id); }
              catch (cause) { report(cause); throw cause; }
            }}
            onDelete={async () => {
              try { await controller.deleteTask(selectedTask.id); setSelectedTaskId(undefined); }
              catch (cause) { report(cause); throw cause; }
            }}
            onAddComment={async (body) => {
              try { await controller.addComment({ taskId: selectedTask.id, body }); }
              catch (cause) { report(cause); throw cause; }
            }}
            onMove={(status) => move(selectedTask.id, status)}
            onResolveGate={async (input) => {
              try { await controller.resolveGate(input); }
              catch (cause) { report(cause); throw cause; }
            }}
            onReviewExecution={async (input) => {
              try { await controller.reviewExecution(input); }
              catch (cause) { report(cause); throw cause; }
            }}
            onRevealPath={(path) => void api.revealPath(path)}
            onContinueInPi={(sessionPath) => onContinueTaskSession(selectedTask.id, sessionPath)}
            agentPresences={deriveAgentPresences(board, catalog, selectedTask.projectPath)}
          />
        )}
      </div>

      {editorTaskId && editorProject && (
        <TaskEditorDialog
          task={editorTask}
          draft={editorTaskId === "new" ? newTaskDraft : undefined}
          project={editorProject}
          workflows={catalog.workflows}
          agents={catalog.agents.filter((agent) => !("projectPath" in agent) || (agent as ProjectAgentDefinition).projectPath === editorProject.cwd)}
          squads={board.squads}
          busy={state.pending.includes(editorTaskId === "new" ? "create" : editorTaskId)}
          onClose={() => setEditorTaskId(undefined)}
          onCreate={async (input) => { await controller.createTask(input); }}
          onUpdate={async (input) => { await controller.updateTask(input); }}
        />
      )}
      {catalogOpen && <CatalogDialog catalog={catalog} onClose={() => setCatalogOpen(false)} />}
      {automationOpen && project && (
        <AutomationStudioDialog
          catalog={Object.freeze({
            ...catalog,
            agents: Object.freeze(catalog.agents.filter((agent) => !("projectPath" in agent) || (agent as ProjectAgentDefinition).projectPath === project.cwd)),
          })}
          project={project}
          squads={board.squads}
          tasks={board.tasks}
          autopilots={board.autopilots}
          autopilotRuns={board.autopilotRuns}
          webhookStatus={state.automationRuntime?.webhook}
          busy={state.pending.some((key) => key.startsWith("squad:") || key.startsWith("autopilot:"))}
          onClose={() => setAutomationOpen(false)}
          onCreateSquad={async (input) => { await controller.createSquad(input); }}
          onUpdateSquad={async (input) => { await controller.updateSquad(input); }}
          onDeleteSquad={async (squadId) => { await controller.deleteSquad(squadId); }}
          onCreateAutopilot={async (input) => { await controller.createAutopilot(input); }}
          onUpdateAutopilot={async (input) => { await controller.updateAutopilot(input); }}
          onDeleteAutopilot={async (autopilotId) => { await controller.deleteAutopilot(autopilotId); }}
          onTriggerAutopilot={async (autopilotId) => { await controller.triggerAutopilot(autopilotId); }}
          onCopy={async (value) => { await api.copyText(value); }}
        />
      )}
    </main>
  );
}

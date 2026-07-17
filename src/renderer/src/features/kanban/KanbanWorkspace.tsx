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
} from "lucide-react";
import type { ProjectMeta, StellaDesktopApi } from "@shared/contracts";
import {
  boardLaneForStatus,
  type BoardLane,
  type KanbanTask,
  type ManualTaskStatus,
} from "@shared/kanban";
import type { KanbanController } from "../../hooks/use-kanban";
import { CatalogDialog } from "./CatalogDialog";
import { LANE_CONFIG } from "./kanban-format";
import { TaskCard } from "./TaskCard";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { TaskEditorDialog } from "./TaskEditorDialog";

interface KanbanWorkspaceProps {
  readonly api: StellaDesktopApi;
  readonly controller: KanbanController;
  readonly project: ProjectMeta;
  readonly createRequest: number;
  readonly onOpenSidebar: () => void;
  readonly onOpenTerminal: () => void;
  readonly onError: (message: string) => void;
}

const MANUAL_LANES = new Set<BoardLane>(["planned", "blocked", "completed"]);
const PRIORITY_ORDER: Readonly<Record<KanbanTask["priority"], number>> = Object.freeze({
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
});

export function KanbanWorkspace({
  api,
  controller,
  project,
  createRequest,
  onOpenSidebar,
  onOpenTerminal,
  onError,
}: KanbanWorkspaceProps) {
  const { state } = controller;
  const [query, setQuery] = useState("");
  const [projectScope, setProjectScope] = useState<"current" | "all">("current");
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [editorTaskId, setEditorTaskId] = useState<string | "new">();
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    if (createRequest > 0) setEditorTaskId("new");
  }, [createRequest]);

  const bootstrap = state.bootstrap;
  const board = bootstrap?.board;
  const catalog = bootstrap?.catalog;
  const selectedTask = board?.tasks.find((task) => task.id === selectedTaskId);
  const editorTask = editorTaskId && editorTaskId !== "new"
    ? board?.tasks.find((task) => task.id === editorTaskId)
    : undefined;

  useEffect(() => {
    if (selectedTaskId && board && !board.tasks.some((task) => task.id === selectedTaskId)) setSelectedTaskId(undefined);
  }, [board, selectedTaskId]);

  const visibleTasks = useMemo(() => {
    if (!board) return [];
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return board.tasks
      .filter((task) => projectScope === "all" || task.projectPath === project.cwd)
      .filter((task) => workflowFilter === "all" || task.workflowId === workflowFilter)
      .filter((task) => !normalizedQuery || `${task.title} ${task.description} ${task.acceptanceCriteria} ${task.projectName}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }, [board, project.cwd, projectScope, query, workflowFilter]);

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

  const move = async (taskId: string, status: ManualTaskStatus) => {
    try {
      await controller.moveTask(taskId, status);
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
    void move(taskId, lane as ManualTaskStatus).catch(() => undefined);
  };

  if (state.phase === "error" && (!bootstrap || !board || !catalog)) {
    return (
      <main className="kanban-workspace kanban-workspace--error">
        <FolderKanban size={30} />
        <h1>看板没有加载成功</h1>
        <p>{state.error}</p>
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
          <button type="button" className="icon-button" aria-label="打开命令终端" onClick={onOpenTerminal}><TerminalSquare size={16} /></button>
          <button type="button" className="button-primary" onClick={() => setEditorTaskId("new")}><Plus size={15} />新建任务</button>
        </div>
      </header>

      <div className="kanban-controls">
        <div className="kanban-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、说明或验收标准" />{query && <button type="button" onClick={() => setQuery("")}>清除</button>}</div>
        <label className="kanban-select"><span>项目</span><select value={projectScope} onChange={(event) => setProjectScope(event.target.value as "current" | "all")}><option value="current">{project.name}</option><option value="all">全部项目</option></select><ChevronDown size={13} /></label>
        <label className="kanban-select"><Workflow size={13} /><select value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value)}><option value="all">全部流程</option>{catalog.workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.shortName}</option>)}</select><ChevronDown size={13} /></label>
        <span className="kanban-controls__count">显示 {visibleTasks.length} / {board.tasks.length} 项</span>
      </div>

      {state.error && <div className="kanban-inline-error" role="alert">{state.error}</div>}

      <div className="kanban-stage">
        <div className="kanban-board" aria-label="任务看板">
          {LANE_CONFIG.map((lane) => {
            const tasks = visibleTasks.filter((task) => boardLaneForStatus(task.status) === lane.id);
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
                    return (
                      <TaskCard
                        key={task.id}
                        task={task}
                        workflow={catalog.workflows.find((workflow) => workflow.id === task.workflowId)}
                        run={run}
                        activities={taskActivities(task.id)}
                        liveEvent={task.activeRunId && run ? state.liveEvents[run.id] : undefined}
                        busy={state.pending.includes(task.id)}
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
            task={selectedTask}
            catalog={catalog}
            runs={taskRuns(selectedTask.id)}
            activities={taskActivities(selectedTask.id)}
            busy={state.pending.includes(selectedTask.id)}
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
            onMove={(status) => move(selectedTask.id, status)}
            onResolveGate={async (input) => {
              try { await controller.resolveGate(input); }
              catch (cause) { report(cause); throw cause; }
            }}
            onRevealPath={(path) => void api.revealPath(path)}
          />
        )}
      </div>

      {editorTaskId && (
        <TaskEditorDialog
          task={editorTask}
          project={editorTask ? {
            ...project,
            cwd: editorTask.projectPath,
            name: editorTask.projectName,
            trusted: editorTask.trusted,
          } : project}
          workflows={catalog.workflows}
          busy={state.pending.includes(editorTaskId === "new" ? "create" : editorTaskId)}
          onClose={() => setEditorTaskId(undefined)}
          onCreate={async (input) => { await controller.createTask(input); }}
          onUpdate={async (input) => { await controller.updateTask(input); }}
        />
      )}
      {catalogOpen && <CatalogDialog catalog={catalog} onClose={() => setCatalogOpen(false)} />}
    </main>
  );
}

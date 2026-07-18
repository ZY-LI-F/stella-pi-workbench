import type { DragEvent } from "react";
import { Activity, AlertTriangle, Bot, Clock3, Play, ShieldAlert } from "lucide-react";
import {
  activeStep,
  workflowProgress,
  type AgentTask,
  type BoardBridgeEvent,
  type KanbanTask,
  type TaskActivity,
  type WorkflowDefinition,
  type WorkflowRun,
} from "@shared/kanban";
import { ACCEPTANCE_LABEL, EXECUTION_STATUS_LABEL, PRIORITY_LABEL, STAGE_LABEL, formatRelativeTime } from "./kanban-format";

interface TaskCardProps {
  readonly task: KanbanTask;
  readonly workflow?: WorkflowDefinition;
  readonly executionLabel: string;
  readonly run?: WorkflowRun;
  readonly agentTask?: AgentTask;
  readonly activities: readonly TaskActivity[];
  readonly liveEvent?: Extract<BoardBridgeEvent, { type: "agent-event" }>;
  readonly liveAgentTaskEvent?: Extract<BoardBridgeEvent, { type: "agent-task-event" }>;
  readonly busy: boolean;
  readonly executionEnabled: boolean;
  readonly onOpen: () => void;
  readonly onDispatch: () => void;
  readonly onDragStart: (event: DragEvent<HTMLElement>) => void;
}

function trailClass(status: WorkflowRun["steps"][number]["status"]): string {
  if (status === "succeeded") return "is-complete";
  if (status === "running") return "is-active";
  if (status === "waiting") return "is-gate";
  if (status === "failed" || status === "interrupted") return "is-failed";
  return "";
}

export function TaskCard({ task, workflow, executionLabel, run, agentTask, activities, liveEvent, liveAgentTaskEvent, busy, executionEnabled, onOpen, onDispatch, onDragStart }: TaskCardProps) {
  const step = activeStep(run);
  const latestActivity = activities.at(-1);
  const canDispatch = !task.activeRunId && !task.activeAgentTaskId && task.stage !== "completed";
  const execution = run ?? agentTask;
  return (
    <article
      className={`kanban-card priority-${task.priority} status-${task.stage}`}
      draggable={!task.activeRunId && !task.activeAgentTaskId}
      onDragStart={onDragStart}
      data-task-id={task.id}
    >
      <div className="kanban-card__edge" />
      <div className="kanban-card__topline">
        <span className={`priority-badge priority-badge--${task.priority}`}>{PRIORITY_LABEL[task.priority]}</span>
        <span className="kanban-card__project">{task.projectName}</span>
        <span className={`status-chip status-chip--${task.stage}`}>{STAGE_LABEL[task.stage]}</span>
      </div>
      <button type="button" className="kanban-card__title" onClick={onOpen}>{task.title}</button>
      {task.description && <p className="kanban-card__description">{task.description}</p>}

      <div className="kanban-card__workflow">
        <span>{executionLabel}</span>
        {run && <strong>{workflowProgress(run)}%</strong>}
      </div>

      {execution && (
        <div className="execution-truth" aria-label="执行与验收状态">
          <span className={`execution-chip execution-chip--${execution.status}`}>{EXECUTION_STATUS_LABEL[execution.status] ?? execution.status}</span>
          <span className={`acceptance-chip acceptance-chip--${execution.acceptance}`}>{ACCEPTANCE_LABEL[execution.acceptance]}</span>
        </div>
      )}

      <div className="star-trail" aria-label={run ? `流程进度 ${workflowProgress(run)}%` : "尚未分发"}>
        {run ? run.steps.map((runStep, index) => (
          <span className={`star-trail__node ${trailClass(runStep.status)}`} key={runStep.id} title={`${runStep.name} · ${runStep.status}`}>
            <i />{index < run.steps.length - 1 && <b />}
          </span>
        )) : workflow?.steps.map((workflowStep, index) => (
          <span className="star-trail__node" key={workflowStep.id} title={workflowStep.name}>
            <i />{index < workflow.steps.length - 1 && <b />}
          </span>
        ))}
        {liveEvent && <span className="star-trail__signal" title={liveEvent.eventType}><Activity size={10} /></span>}
      </div>

      {agentTask && (
        <div className={`agent-task-rail agent-task-rail--${agentTask.status}`}>
          <span><i /><b /></span>
          <div><small>{agentTask.kind === "direct" ? "DIRECT AGENT" : agentTask.kind === "mention-root" ? "MENTION GROUP" : agentTask.kind === "squad-leader" ? "SQUAD LEADER" : agentTask.kind === "coordinator" ? "LEAD COORDINATOR" : agentTask.kind === "coordinator-review" ? "LEAD REVIEW" : "DELEGATED"}</small><strong>{agentTask.agentSnapshot.name}</strong></div>
          <em>{liveAgentTaskEvent?.eventType ?? agentTask.status}</em>
        </div>
      )}

      {task.blockedReason && <div className="kanban-card__alert"><AlertTriangle size={13} /><span>{task.blockedReason}</span></div>}
      {step && (
        <div className="kanban-card__agent">
          {step.stepKind === "human-gate" ? <ShieldAlert size={14} /> : <Bot size={14} />}
          <span><small>{step.stepKind === "human-gate" ? "人工关卡" : "当前 Agent"}</small><strong>{step.name}</strong></span>
          {step.status === "running" && <i className="agent-pulse" />}
        </div>
      )}
      {!step && agentTask && !["reported", "failed", "interrupted", "cancelled"].includes(agentTask.status) && (
        <div className="kanban-card__agent">
          <Bot size={14} />
          <span><small>当前 Agent</small><strong>{agentTask.agentSnapshot.name}</strong></span>
          {agentTask.status === "running" && <i className="agent-pulse" />}
        </div>
      )}

      <div className="kanban-card__footer">
        <span title={latestActivity?.summary}><Clock3 size={11} />{formatRelativeTime(latestActivity?.createdAt ?? task.updatedAt)}</span>
        {canDispatch && (
          <button type="button" onClick={(event) => { event.stopPropagation(); onDispatch(); }} disabled={busy || !executionEnabled} title={executionEnabled ? undefined : "Pi Runtime 不可用，暂时不能分发"} aria-label={`分发任务 ${task.title}`}>
            <Play size={12} fill="currentColor" />分发
          </button>
        )}
      </div>
    </article>
  );
}

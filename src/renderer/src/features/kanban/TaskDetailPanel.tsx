import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Ban,
  Bot,
  Check,
  ExternalLink,
  FileOutput,
  Flag,
  GitBranch,
  MessageCircle,
  MessagesSquare,
  Pencil,
  Play,
  Radio,
  RotateCcw,
  Send,
  Trash2,
  UserRound,
  X,
  XCircle,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { availableMentionAgentsForTask, parseAgentMentions } from "@shared/agent-mentions";
import type { AgentMentionQuery } from "@shared/agent-mentions";
import type { AgentPresence } from "@shared/agent-presence";
import { MANUAL_TASK_STAGES } from "@shared/kanban";
import type {
  AgentTask,
  KanbanTask,
  ManualTaskStage,
  OrchestrationCatalog,
  ReviewExecutionInput,
  ResolveGateInput,
  Squad,
  TaskActivity,
  TaskComment,
  WorkflowRun,
} from "@shared/kanban";
import { projectTaskTimeline, type TaskTimelineEntry, type TaskTimelineKind } from "@shared/task-timeline";
import { ACCEPTANCE_LABEL, EXECUTION_STATUS_LABEL, PRIORITY_LABEL, STAGE_LABEL, formatRelativeTime } from "./kanban-format";
import { ArtifactDetails } from "./ArtifactDetails";
import { AgentMentionInput, type AgentMentionRequest } from "./AgentMentionInput";
import { WorkflowDag } from "./WorkflowDag";

interface TaskDetailPanelProps {
  readonly task: KanbanTask;
  readonly catalog: OrchestrationCatalog;
  readonly squads: readonly Squad[];
  readonly runs: readonly WorkflowRun[];
  readonly agentTasks: readonly AgentTask[];
  readonly comments: readonly TaskComment[];
  readonly activities: readonly TaskActivity[];
  readonly busy: boolean;
  readonly executionEnabled: boolean;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onDispatch: () => Promise<void>;
  readonly onAbort: () => Promise<void>;
  readonly onDelete: () => Promise<void>;
  readonly onAddComment: (body: string) => Promise<void>;
  readonly onMove: (stage: ManualTaskStage) => Promise<void>;
  readonly onResolveGate: (input: ResolveGateInput) => Promise<void>;
  readonly onReviewExecution: (input: ReviewExecutionInput) => Promise<void>;
  readonly onRevealPath: (path: string) => void;
  readonly onContinueInPi: (sessionPath: string) => Promise<void>;
  readonly agentPresences?: readonly AgentPresence[];
  readonly mentionRequest?: AgentMentionRequest;
  readonly variant?: "drawer" | "workspace";
}

interface MentionPreview {
  readonly agents: readonly { readonly id: string; readonly name: string; readonly callsign: string }[];
  readonly coordinator?: boolean;
  readonly resumesLead?: boolean;
  readonly error?: string;
}

function timelineIcon(kind: TaskTimelineKind) {
  switch (kind) {
    case "goal": return <Flag size={13} />;
    case "user-message": return <UserRound size={13} />;
    case "agent-output": return <Bot size={13} />;
    case "dispatch-receipt": return <Radio size={13} />;
    case "execution": return <GitBranch size={13} />;
    case "artifact": return <FileOutput size={13} />;
    case "review": return <BadgeCheck size={13} />;
    default: return <MessageCircle size={13} />;
  }
}

function TimelineProvenance({ entry }: { readonly entry: TaskTimelineEntry }) {
  const { provenance } = entry;
  return (
    <div className="task-room-entry__provenance" aria-label="事实来源">
      <span>{provenance.source}</span>
      {provenance.runId && <code title={provenance.runId}>RUN {provenance.runId.slice(0, 8)}</code>}
      {provenance.stepId && <code title={provenance.stepId}>STEP {provenance.stepId.slice(0, 8)}</code>}
      {provenance.agentTaskId && <code title={provenance.agentTaskId}>AGENTTASK {provenance.agentTaskId.slice(0, 8)}</code>}
    </div>
  );
}

export function TaskDetailPanel({
  task,
  catalog,
  squads,
  runs,
  agentTasks,
  comments,
  activities,
  busy,
  executionEnabled,
  onClose,
  onEdit,
  onDispatch,
  onAbort,
  onDelete,
  onAddComment,
  onMove,
  onResolveGate,
  onReviewExecution,
  onRevealPath,
  onContinueInPi,
  agentPresences = [],
  mentionRequest,
  variant = "drawer",
}: TaskDetailPanelProps) {
  const [gateComment, setGateComment] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const [activeMentionQuery, setActiveMentionQuery] = useState<AgentMentionQuery>();
  const timeline = useMemo(
    () => projectTaskTimeline({ task, comments, activities, runs, agentTasks }),
    [activities, agentTasks, comments, runs, task],
  );
  const run = useMemo(
    () => runs.find((candidate) => candidate.id === task.activeRunId)
      ?? [...runs].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0],
    [runs, task.activeRunId],
  );
  const currentGate = run?.status === "review" && run.currentStepId
    ? run.steps.find((step) => step.stepId === run.currentStepId && step.stepKind === "human-gate" && step.status === "waiting")
    : undefined;
  const executionTarget = task.executionTarget;
  const workflow = executionTarget.kind === "workflow"
    ? catalog.workflows.find((candidate) => candidate.id === executionTarget.workflowId)
    : undefined;
  const executionLabel = executionTarget.kind === "workflow"
    ? workflow?.shortName ?? executionTarget.workflowId
    : executionTarget.kind === "agent"
      ? catalog.agents.find((agent) => agent.id === executionTarget.agentId)?.name ?? executionTarget.agentId
      : squads.find((squad) => squad.id === executionTarget.squadId)?.name ?? executionTarget.squadId;
  const isRedispatch = task.stage === "blocked";
  const activeAgentTask = agentTasks.find((candidate) => candidate.id === task.activeAgentTaskId);
  const waitingCoordinator = activeAgentTask?.kind === "coordinator" && activeAgentTask.status === "waiting_human";
  const mentionAgents = useMemo(() => availableMentionAgentsForTask(task, catalog, squads), [catalog, squads, task]);
  const mentionsDisabledReason = task.activeRunId || task.activeAgentTaskId
    ? waitingCoordinator
      ? "LEAD 正在等待你的普通回复；当前不能并行创建新的 mention"
      : "任务正在执行；请先中止或等待完成后再使用 @mention 分发"
    : task.stage === "completed"
      ? "已完成任务需先移回待规划列才能使用 @mention 分发"
      : undefined;
  const rootAgentTask = [...agentTasks].reverse().find((candidate) => !candidate.parentAgentTaskId);
  const executionTruth = [
    ...(run ? [{ kind: "workflow" as const, execution: run }] : []),
    ...(rootAgentTask ? [{ kind: "agent-task" as const, execution: rootAgentTask }] : []),
  ].sort((left, right) => Date.parse(right.execution.updatedAt) - Date.parse(left.execution.updatedAt))[0];
  const reviewTarget = [
    ...runs.filter((candidate) => candidate.status === "reported" && candidate.acceptance === "pending").map((execution) => ({ kind: "workflow" as const, execution })),
    ...agentTasks.filter((candidate) => !candidate.parentAgentTaskId && candidate.status === "reported" && candidate.acceptance === "pending").map((execution) => ({ kind: "agent-task" as const, execution })),
  ].sort((left, right) => Date.parse(right.execution.updatedAt) - Date.parse(left.execution.updatedAt))[0];
  const mentionPreview = useMemo<MentionPreview>(() => {
    if (!commentBody.trim()) return Object.freeze({ agents: Object.freeze([]) });
    try {
      const previewBody = activeMentionQuery
        ? `${commentBody.slice(0, activeMentionQuery.start)}${commentBody.slice(activeMentionQuery.end)}`
        : commentBody;
      const agents = parseAgentMentions(previewBody, mentionAgents).agents.map((agent) => Object.freeze({ id: agent.id, name: agent.name, callsign: agent.callsign }));
      if (agents.length === 0 && waitingCoordinator) return Object.freeze({ agents: Object.freeze([]), resumesLead: true });
      if (agents.length > 0 && (task.activeRunId || task.activeAgentTaskId)) {
        return Object.freeze({ agents: Object.freeze(agents), error: "任务正在执行；请先中止或等待完成后再使用 @mention 分发" });
      }
      if (agents.length > 0 && task.stage === "completed") {
        return Object.freeze({ agents: Object.freeze(agents), error: "已完成任务需先移回待规划列才能使用 @mention 分发" });
      }
      const coordinator = agents[0]?.id === "lead";
      if (coordinator && agents.length > 1) {
        return Object.freeze({ agents: Object.freeze(agents), coordinator, error: "@LEAD 协调模式不能与直接 Worker mention 混用；请让 LEAD 通过结构化计划委派" });
      }
      return Object.freeze({ agents: Object.freeze(agents), coordinator });
    } catch (cause) {
      return Object.freeze({ agents: Object.freeze([]), error: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [activeMentionQuery, commentBody, mentionAgents, task.activeAgentTaskId, task.activeRunId, task.stage, waitingCoordinator]);

  useEffect(() => {
    setCommentBody("");
    setActiveMentionQuery(undefined);
  }, [task.id]);

  const perform = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const isReviewEntry = (entry: TaskTimelineEntry) => Boolean(reviewTarget)
    && entry.kind === "execution"
    && entry.provenance.sourceId === reviewTarget?.execution.id
    && entry.provenance.source === (reviewTarget?.kind === "workflow" ? "workflow-run" : "agent-task");

  return (
    <aside className={`task-detail task-detail--${variant}`} aria-label={`任务详情：${task.title}`}>
      <header className="task-detail__header">
        <div><small>TASK ROOM</small><h2>{task.title}</h2></div>
        {variant === "drawer" && <button type="button" className="icon-button" aria-label="关闭任务详情" onClick={onClose}><X size={17} /></button>}
      </header>

      <div className="task-detail__scroll">
        <div className="task-detail__badges">
          <span className={`status-chip status-chip--${task.stage}`}>任务 · {STAGE_LABEL[task.stage]}</span>
          <span className={`priority-badge priority-badge--${task.priority}`}>{PRIORITY_LABEL[task.priority]}优先级</span>
          <span>{executionLabel}</span>
        </div>
        {executionTruth && (
          <div className="task-detail__execution-truth">
            <span className={`execution-chip execution-chip--${executionTruth.execution.status}`}>执行 · {EXECUTION_STATUS_LABEL[executionTruth.execution.status] ?? executionTruth.execution.status}</span>
            <span className={`acceptance-chip acceptance-chip--${executionTruth.execution.acceptance}`}>验收 · {ACCEPTANCE_LABEL[executionTruth.execution.acceptance]}</span>
          </div>
        )}
        {task.blockedReason && <div className="task-detail__blocked"><XCircle size={14} /><span>{task.blockedReason}</span></div>}

        <WorkflowDag
          workflowExpected={executionTarget.kind === "workflow"}
          runs={runs}
          busy={busy}
          executionEnabled={executionEnabled}
          onRevealPath={onRevealPath}
          onContinueInPi={onContinueInPi}
          onError={setError}
        />

        <section className="task-room" aria-label="任务事实时间线">
          <header className="task-room__header">
            <div><small>TASK ROOM TIMELINE</small><h3>任务事实流</h3></div>
            <span>{timeline.length} 条</span>
          </header>
          <div className="task-room__timeline">
            {timeline.map((entry) => (
              <div className="task-room-entry-wrap" key={entry.id}>
                <article className={`task-room-entry task-room-entry--${entry.kind}`} data-source-id={entry.provenance.sourceId}>
                  <span className="task-room-entry__marker" aria-hidden="true">{timelineIcon(entry.kind)}</span>
                  <div className="task-room-entry__body">
                    <header><strong>{entry.title}</strong><time dateTime={entry.createdAt}>{formatRelativeTime(entry.createdAt)}</time></header>
                    {entry.detail && <small className="task-room-entry__detail">{entry.detail}</small>}
                    {entry.body && (entry.kind === "agent-output"
                      ? <div className="artifact-markdown task-room-entry__markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body}</ReactMarkdown></div>
                      : <p>{entry.body}</p>)}
                    {(entry.status || entry.acceptance) && (
                      <div className="task-room-entry__truth">
                        {entry.status && <span className={`execution-chip execution-chip--${entry.status}`}>{EXECUTION_STATUS_LABEL[entry.status] ?? entry.status}</span>}
                        {entry.acceptance && <span className={`acceptance-chip acceptance-chip--${entry.acceptance}`}>{ACCEPTANCE_LABEL[entry.acceptance]}</span>}
                      </div>
                    )}
                    {entry.artifact && <ArtifactDetails artifact={entry.artifact} onRevealPath={onRevealPath} />}
                    {entry.sessionPath && (
                      <div className="task-room-entry__session-actions">
                        <button type="button" className="button-secondary" onClick={() => onRevealPath(entry.sessionPath ?? "")}><ExternalLink size={12} />文件位置</button>
                        <button type="button" className="button-secondary" disabled={!executionEnabled || busy} onClick={() => void perform(() => onContinueInPi(entry.sessionPath ?? ""))}><MessagesSquare size={12} />在 Pi 中继续</button>
                      </div>
                    )}
                    <TimelineProvenance entry={entry} />
                  </div>
                </article>

                {currentGate && entry.provenance.source === "workflow-step" && entry.provenance.sourceId === currentGate.id && (
                  <section className="human-gate-card task-room__inline-control">
                    <small>HUMAN GATE</small>
                    <h3>{currentGate.name}</h3>
                    <p>{run?.workflow.steps.find((step) => step.id === currentGate.stepId && step.kind === "human-gate")?.summary}</p>
                    <textarea value={gateComment} onChange={(event) => setGateComment(event.target.value)} rows={3} placeholder="填写批准说明或驳回原因（可选）" />
                    <div>
                      <button type="button" className="button-danger-soft" disabled={busy || !executionEnabled} onClick={() => void perform(() => onResolveGate({ taskId: task.id, decision: "reject", comment: gateComment }))}><X size={14} />驳回</button>
                      <button type="button" className="button-primary" disabled={busy || !executionEnabled} onClick={() => void perform(() => onResolveGate({ taskId: task.id, decision: "approve", comment: gateComment }))}><Check size={14} />批准并继续</button>
                    </div>
                  </section>
                )}

                {isReviewEntry(entry) && reviewTarget && (
                  <section className="execution-review-card task-room__inline-control">
                    <small>EXECUTION ACCEPTANCE</small>
                    <h3>验收本次执行报告</h3>
                    <p>“已报告”只表示 Agent 返回了结果。请根据任务验收标准明确记录结论。</p>
                    <textarea value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} rows={3} placeholder="接受可选填说明；请求修订或拒绝必须填写理由" />
                    <div>
                      <button type="button" className="button-danger-soft" disabled={busy || !reviewComment.trim()} onClick={() => void perform(() => onReviewExecution({ taskId: task.id, executionKind: reviewTarget.kind, executionId: reviewTarget.execution.id, decision: "reject", comment: reviewComment }))}><X size={14} />拒绝</button>
                      <button type="button" className="button-secondary" disabled={busy || !reviewComment.trim()} onClick={() => void perform(() => onReviewExecution({ taskId: task.id, executionKind: reviewTarget.kind, executionId: reviewTarget.execution.id, decision: "revision-requested", comment: reviewComment }))}><RotateCcw size={14} />请求修订</button>
                      <button type="button" className="button-primary" disabled={busy} onClick={() => void perform(() => onReviewExecution({ taskId: task.id, executionKind: reviewTarget.kind, executionId: reviewTarget.execution.id, decision: "accept", comment: reviewComment }))}><Check size={14} />接受报告</button>
                    </div>
                  </section>
                )}
              </div>
            ))}
          </div>

          <form className="task-comment-composer task-room__composer" onSubmit={(event) => {
            event.preventDefault();
            const body = commentBody;
            void perform(async () => {
              await onAddComment(body);
              setCommentBody("");
            });
          }}>
            <label htmlFor={`task-room-message-${task.id}`}>发送到 Task Room</label>
            <AgentMentionInput
              id={`task-room-message-${task.id}`}
              value={commentBody}
              agents={mentionAgents}
              presences={agentPresences}
              mentionRequest={mentionRequest}
              mentionsDisabled={Boolean(mentionsDisabledReason)}
              mentionsDisabledReason={mentionsDisabledReason}
              rows={3}
              placeholder={waitingCoordinator ? "回复 LEAD 的问题；提交后自动进入下一决策回合…" : "补充上下文；输入 @ 选择 Agent，或直接发送普通消息…"}
              onChange={setCommentBody}
              onQueryChange={setActiveMentionQuery}
              onRequestError={setError}
            />
            {commentBody.trim() && (
              <div className={`mention-impact ${mentionPreview.error ? "is-error" : mentionPreview.agents.length > 0 ? "is-dispatch" : "is-comment"}`} role={mentionPreview.error ? "alert" : "status"}>
                {mentionPreview.error
                  ? <><XCircle size={13} /><span>{mentionPreview.error}</span></>
                  : mentionPreview.resumesLead
                    ? <><GitBranch size={13} /><span>提交后将唤醒 @lead，创建新的 Coordinator 验收回合。</span></>
                    : mentionPreview.agents.length > 0
                    ? <><GitBranch size={13} /><span>{mentionPreview.coordinator ? "提交后将创建 1 个 Coordinator AgentTask" : `提交后将创建 ${mentionPreview.agents.length} 个 AgentTask`}：{mentionPreview.agents.map((agent) => `${agent.name} (@${agent.callsign})`).join(" → ")}</span></>
                    : <><MessageCircle size={13} /><span>提交后仅追加用户消息，不创建 AgentTask。</span></>}
              </div>
            )}
            <button type="submit" className="button-secondary" aria-label="发送评论" disabled={busy || !commentBody.trim() || Boolean(activeMentionQuery) || Boolean(mentionPreview.error)}><Send size={13} />发送消息</button>
          </form>
        </section>
      </div>

      {error && <p className="task-detail__error" role="alert">{error}</p>}
      {!executionEnabled && !task.activeRunId && !task.activeAgentTaskId && task.stage !== "completed" && <p className="task-detail__execution-disabled">Pi Runtime 不可用；任务记录仍可编辑，执行入口已暂停。</p>}
      <footer className="task-detail__actions">
        {!task.activeRunId && !task.activeAgentTaskId && task.stage !== "completed" && <button type="button" className="button-primary" disabled={busy || !executionEnabled} onClick={() => void perform(onDispatch)}>{isRedispatch ? <RotateCcw size={14} /> : <Play size={14} />}{isRedispatch ? "重新分发" : "开始执行"}</button>}
        {(task.activeRunId || task.activeAgentTaskId) && <button type="button" className="button-danger-soft" disabled={busy} onClick={() => void perform(onAbort)}><Ban size={14} />中止执行</button>}
        {!task.activeRunId && !task.activeAgentTaskId && <button type="button" className="button-secondary" disabled={busy} onClick={onEdit}><Pencil size={14} />编辑</button>}
        {!task.activeRunId && !task.activeAgentTaskId && (
          <select aria-label="手动移动任务" value="" disabled={busy} onChange={(event) => {
            const stage = event.target.value as ManualTaskStage;
            if (stage) void perform(() => onMove(stage));
          }}>
            <option value="">移动到…</option>
            {MANUAL_TASK_STAGES.map((stage) => <option value={stage} key={stage}>{STAGE_LABEL[stage]}</option>)}
          </select>
        )}
        {!task.activeRunId && !task.activeAgentTaskId && (!confirmDelete
          ? <button type="button" className="icon-button task-delete" aria-label="删除任务" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></button>
          : <button type="button" className="button-danger-soft" disabled={busy} onClick={() => void perform(onDelete)}><Trash2 size={14} />确认删除</button>)}
      </footer>
    </aside>
  );
}

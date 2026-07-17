import { useMemo, useState } from "react";
import { Ban, Check, Clipboard, ExternalLink, Pencil, Play, RotateCcw, Trash2, X, XCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  KanbanTask,
  ManualTaskStatus,
  OrchestrationCatalog,
  ResolveGateInput,
  TaskActivity,
  WorkflowRun,
} from "@shared/kanban";
import { PRIORITY_LABEL, STATUS_LABEL, formatRelativeTime } from "./kanban-format";

interface TaskDetailPanelProps {
  readonly task: KanbanTask;
  readonly catalog: OrchestrationCatalog;
  readonly runs: readonly WorkflowRun[];
  readonly activities: readonly TaskActivity[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onEdit: () => void;
  readonly onDispatch: () => Promise<void>;
  readonly onAbort: () => Promise<void>;
  readonly onDelete: () => Promise<void>;
  readonly onMove: (status: ManualTaskStatus) => Promise<void>;
  readonly onResolveGate: (input: ResolveGateInput) => Promise<void>;
  readonly onRevealPath: (path: string) => void;
}

export function TaskDetailPanel({
  task,
  catalog,
  runs,
  activities,
  busy,
  onClose,
  onEdit,
  onDispatch,
  onAbort,
  onDelete,
  onMove,
  onResolveGate,
  onRevealPath,
}: TaskDetailPanelProps) {
  const [gateComment, setGateComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  const run = useMemo(() => runs.find((candidate) => candidate.id === task.activeRunId) ?? runs[0], [runs, task.activeRunId]);
  const currentGate = run?.status === "review" && run.currentStepId
    ? run.steps.find((step) => step.stepId === run.currentStepId && step.stepKind === "human-gate" && step.status === "waiting")
    : undefined;
  const workflow = catalog.workflows.find((candidate) => candidate.id === task.workflowId);
  const isRedispatch = task.status === "failed" || task.status === "interrupted" || task.status === "blocked";

  const perform = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <aside className="task-detail" aria-label={`任务详情：${task.title}`}>
      <header className="task-detail__header">
        <div><small>MISSION DETAIL</small><h2>{task.title}</h2></div>
        <button type="button" className="icon-button" aria-label="关闭任务详情" onClick={onClose}><X size={17} /></button>
      </header>

      <div className="task-detail__scroll">
        <div className="task-detail__badges">
          <span className={`status-chip status-chip--${task.status}`}>{STATUS_LABEL[task.status]}</span>
          <span className={`priority-badge priority-badge--${task.priority}`}>{PRIORITY_LABEL[task.priority]}优先级</span>
          <span>{workflow?.shortName ?? task.workflowId}</span>
        </div>

        <section className="task-detail__section task-detail__copy">
          <h3>任务说明</h3>
          <p>{task.description || "未填写补充说明。"}</p>
          <h3>验收标准</h3>
          <p>{task.acceptanceCriteria || "未填写补充标准。"}</p>
          {task.blockedReason && <div className="task-detail__blocked"><XCircle size={14} /><span>{task.blockedReason}</span></div>}
        </section>

        {currentGate && (
          <section className="human-gate-card">
            <small>HUMAN GATE</small>
            <h3>{currentGate.name}</h3>
            <p>{run?.workflow.steps.find((step) => step.id === currentGate.stepId && step.kind === "human-gate")?.summary}</p>
            <textarea value={gateComment} onChange={(event) => setGateComment(event.target.value)} rows={3} placeholder="填写批准说明或驳回原因（可选）" />
            <div>
              <button type="button" className="button-danger-soft" disabled={busy} onClick={() => void perform(() => onResolveGate({ taskId: task.id, decision: "reject", comment: gateComment }))}><X size={14} />驳回</button>
              <button type="button" className="button-primary" disabled={busy} onClick={() => void perform(() => onResolveGate({ taskId: task.id, decision: "approve", comment: gateComment }))}><Check size={14} />批准并继续</button>
            </div>
          </section>
        )}

        {run && (
          <section className="task-detail__section">
            <div className="section-title"><div><small>RUN {run.id.slice(0, 8)}</small><h3>流程轨迹</h3></div><span>{run.workflow.name}</span></div>
            <div className="run-timeline">
              {run.steps.map((step, index) => {
                const agent = step.agentId ? run.agents.find((candidate) => candidate.id === step.agentId) : undefined;
                return (
                  <div className={`run-step run-step--${step.status}`} key={step.id}>
                    <span className="run-step__marker">{step.status === "succeeded" ? <Check size={12} /> : index + 1}</span>
                    <div className="run-step__body">
                      <div><strong>{step.name}</strong><small>{agent?.name ?? "人工关卡"}</small><em>{step.status}</em></div>
                      {step.error && <p className="run-step__error">{step.error}</p>}
                      {step.artifact && (
                        <details className="artifact-card">
                          <summary>{step.artifact.title}<span>查看产物</span></summary>
                          <div className="artifact-card__actions">
                            <button type="button" onClick={() => void navigator.clipboard.writeText(step.artifact?.content ?? "")}><Clipboard size={12} />复制</button>
                            {step.artifact.sessionPath && <button type="button" onClick={() => onRevealPath(step.artifact?.sessionPath ?? "")}><ExternalLink size={12} />会话文件</button>}
                          </div>
                          <div className="artifact-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{step.artifact.content}</ReactMarkdown></div>
                          {(step.artifact.inputTokens !== undefined || step.artifact.outputTokens !== undefined) && <footer>{step.artifact.inputTokens ?? 0} 输入 · {step.artifact.outputTokens ?? 0} 输出{step.artifact.cost !== undefined ? ` · $${step.artifact.cost.toFixed(4)}` : ""}</footer>}
                        </details>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="task-detail__section">
          <div className="section-title"><div><small>ACTIVITY</small><h3>事件记录</h3></div></div>
          <div className="activity-list">
            {[...activities].reverse().map((activity) => (
              <div key={activity.id} className={`activity-item activity-item--${activity.kind}`}>
                <i /><div><strong>{activity.summary}</strong>{activity.detail && <p>{activity.detail}</p>}<small>{formatRelativeTime(activity.createdAt)}</small></div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {error && <p className="task-detail__error" role="alert">{error}</p>}
      <footer className="task-detail__actions">
        {!task.activeRunId && task.status !== "completed" && <button type="button" className="button-primary" disabled={busy} onClick={() => void perform(onDispatch)}>{isRedispatch ? <RotateCcw size={14} /> : <Play size={14} />}{isRedispatch ? "重新分发" : "分发流程"}</button>}
        {task.activeRunId && <button type="button" className="button-danger-soft" disabled={busy} onClick={() => void perform(onAbort)}><Ban size={14} />中止流程</button>}
        {!task.activeRunId && <button type="button" className="button-secondary" disabled={busy} onClick={onEdit}><Pencil size={14} />编辑</button>}
        {!task.activeRunId && (
          <select aria-label="手动移动任务" value="" disabled={busy} onChange={(event) => {
            const status = event.target.value as ManualTaskStatus;
            if (status) void perform(() => onMove(status));
          }}>
            <option value="">移动到…</option>
            <option value="planned">待规划</option>
            <option value="blocked">受阻</option>
            <option value="completed">已完成</option>
          </select>
        )}
        {!task.activeRunId && (!confirmDelete
          ? <button type="button" className="icon-button task-delete" aria-label="删除任务" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></button>
          : <button type="button" className="button-danger-soft" disabled={busy} onClick={() => void perform(onDelete)}><Trash2 size={14} />确认删除</button>)}
      </footer>
    </aside>
  );
}

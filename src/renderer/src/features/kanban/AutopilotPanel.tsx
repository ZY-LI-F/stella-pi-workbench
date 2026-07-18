import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Clock3, Copy, Play, Plus, Radio, Save, Trash2, Webhook } from "lucide-react";
import type { ProjectMeta } from "@shared/contracts";
import {
  TASK_PRIORITIES,
  type AutomationRuntimeStatus,
  type Autopilot,
  type AutopilotRun,
  type AutopilotTrigger,
  type CreateAutopilotInput,
  type ExecutionTarget,
  type OrchestrationCatalog,
  type Squad,
  type TaskPriority,
  type UpdateAutopilotInput,
} from "@shared/kanban";

interface AutopilotPanelProps {
  readonly project: ProjectMeta;
  readonly catalog: OrchestrationCatalog;
  readonly squads: readonly Squad[];
  readonly autopilots: readonly Autopilot[];
  readonly runs: readonly AutopilotRun[];
  readonly webhookStatus?: AutomationRuntimeStatus["webhook"];
  readonly busy: boolean;
  readonly onCreate: (input: CreateAutopilotInput) => Promise<void>;
  readonly onUpdate: (input: UpdateAutopilotInput) => Promise<void>;
  readonly onDelete: (autopilotId: string) => Promise<void>;
  readonly onTrigger: (autopilotId: string) => Promise<void>;
  readonly onCopy: (value: string) => Promise<void>;
}

interface AutopilotDraft {
  readonly name: string;
  readonly enabled: boolean;
  readonly triggerKind: AutopilotTrigger["kind"];
  readonly intervalMinutes: string;
  readonly nextRunAt: string;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
  readonly target: string;
}

function localDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function initialNextRun(): string {
  return localDateTime(new Date(Date.now() + 60 * 60_000).toISOString());
}

function targetValue(target: ExecutionTarget): string {
  if (target.kind === "workflow") return `workflow:${target.workflowId}`;
  if (target.kind === "agent") return `agent:${target.agentId}`;
  return `squad:${target.squadId}`;
}

function parseTarget(value: string): ExecutionTarget {
  const separator = value.indexOf(":");
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id) throw new Error("请选择执行目标");
  if (kind === "workflow") return Object.freeze({ kind, workflowId: id });
  if (kind === "agent") return Object.freeze({ kind, agentId: id });
  if (kind === "squad") return Object.freeze({ kind, squadId: id });
  throw new Error(`无效执行目标: ${value}`);
}

function emptyDraft(catalog: OrchestrationCatalog): AutopilotDraft {
  const firstWorkflow = catalog.workflows[0];
  const firstAgent = catalog.agents[0];
  const target = firstWorkflow
    ? `workflow:${firstWorkflow.id}`
    : firstAgent ? `agent:${firstAgent.id}` : "";
  return Object.freeze({
    name: "",
    enabled: true,
    triggerKind: "manual",
    intervalMinutes: "60",
    nextRunAt: initialNextRun(),
    title: "",
    description: "",
    acceptanceCriteria: "",
    priority: "medium",
    target,
  });
}

function draftFromAutopilot(autopilot: Autopilot): AutopilotDraft {
  return Object.freeze({
    name: autopilot.name,
    enabled: autopilot.enabled,
    triggerKind: autopilot.trigger.kind,
    intervalMinutes: autopilot.trigger.kind === "schedule" ? String(autopilot.trigger.intervalMinutes) : "60",
    nextRunAt: autopilot.trigger.kind === "schedule" ? localDateTime(autopilot.trigger.nextRunAt) : initialNextRun(),
    title: autopilot.taskTemplate.title,
    description: autopilot.taskTemplate.description,
    acceptanceCriteria: autopilot.taskTemplate.acceptanceCriteria,
    priority: autopilot.taskTemplate.priority,
    target: targetValue(autopilot.executionTarget),
  });
}

function runLabel(status: AutopilotRun["status"]): string {
  if (status === "succeeded") return "已分发";
  if (status === "failed") return "失败";
  if (status === "missed") return "错过";
  return "分发中";
}

function triggerLabel(trigger: AutopilotTrigger): string {
  if (trigger.kind === "manual") return "Manual";
  if (trigger.kind === "schedule") return `每 ${trigger.intervalMinutes} 分钟`;
  return "Webhook";
}

export function AutopilotPanel({
  project,
  catalog,
  squads,
  autopilots,
  runs,
  webhookStatus,
  busy,
  onCreate,
  onUpdate,
  onDelete,
  onTrigger,
  onCopy,
}: AutopilotPanelProps) {
  const [selectedId, setSelectedId] = useState<string | "new">(autopilots[0]?.id ?? "new");
  const selected = selectedId === "new" ? undefined : autopilots.find((autopilot) => autopilot.id === selectedId);
  const [draft, setDraft] = useState<AutopilotDraft>(() => selected ? draftFromAutopilot(selected) : emptyDraft(catalog));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const next = selectedId === "new" ? undefined : autopilots.find((autopilot) => autopilot.id === selectedId);
    setDraft(next ? draftFromAutopilot(next) : emptyDraft(catalog));
    setError("");
    setConfirmDelete(false);
    setCopied(false);
  }, [autopilots, catalog, selectedId]);

  const selectedRuns = useMemo(
    () => selected ? runs.filter((run) => run.autopilotId === selected.id) : [],
    [runs, selected],
  );

  const update = <K extends keyof AutopilotDraft>(key: K, value: AutopilotDraft[K]) => {
    setDraft((current) => Object.freeze({ ...current, [key]: value }));
  };

  const createTrigger = (): CreateAutopilotInput["trigger"] => {
    if (draft.triggerKind === "manual") return Object.freeze({ kind: "manual" });
    if (draft.triggerKind === "webhook") return Object.freeze({ kind: "webhook" });
    const intervalMinutes = Number(draft.intervalMinutes);
    if (!Number.isInteger(intervalMinutes) || intervalMinutes <= 0) throw new Error("计划间隔必须是正整数分钟");
    const timestamp = new Date(draft.nextRunAt);
    if (Number.isNaN(timestamp.getTime())) throw new Error("请选择首次运行时间");
    return Object.freeze({ kind: "schedule", intervalMinutes, nextRunAt: timestamp.toISOString() });
  };

  const commonInput = () => Object.freeze({
    name: draft.name,
    enabled: draft.enabled,
    taskTemplate: Object.freeze({
      title: draft.title,
      description: draft.description,
      acceptanceCriteria: draft.acceptanceCriteria,
      priority: draft.priority,
    }),
    projectPath: project.cwd,
    projectName: project.name,
    trusted: project.trusted,
    executionTarget: parseTarget(draft.target),
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const common = commonInput();
      if (selected) {
        let trigger: AutopilotTrigger;
        if (selected.trigger.kind === "webhook") trigger = selected.trigger;
        else {
          const next = createTrigger();
          if (next.kind === "webhook") throw new Error("已有规则不能直接改为 Webhook；请新建 Webhook 规则");
          trigger = next;
        }
        await onUpdate(Object.freeze({ ...common, autopilotId: selected.id, trigger }));
      } else {
        await onCreate(Object.freeze({ ...common, trigger: createTrigger() }));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const triggerNow = async () => {
    if (!selected) return;
    setError("");
    try {
      await onTrigger(selected.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const webhookUrl = selected?.trigger.kind === "webhook"
    ? `http://${webhookStatus?.host ?? "127.0.0.1"}:${webhookStatus?.port ?? 43127}/api/webhooks/${encodeURIComponent(selected.trigger.token)}`
    : undefined;

  const copyWebhookUrl = async () => {
    if (!webhookUrl) return;
    setError("");
    try {
      await onCopy(webhookUrl);
      setCopied(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <div className="automation-studio__layout autopilot-layout">
      <aside className="squad-directory autopilot-directory">
        <header><div><small>AUTOPILOTS</small><strong>触发规则</strong></div><button type="button" aria-label="创建 Autopilot" onClick={() => setSelectedId("new")}><Plus size={14} /></button></header>
        <div>
          {autopilots.map((autopilot) => (
            <button type="button" className={selectedId === autopilot.id ? "is-selected" : ""} key={autopilot.id} onClick={() => setSelectedId(autopilot.id)}>
              <span>{autopilot.trigger.kind === "manual" ? <Play size={13} /> : autopilot.trigger.kind === "schedule" ? <Clock3 size={13} /> : <Webhook size={13} />}</span>
              <div><strong>{autopilot.name}</strong><small>{triggerLabel(autopilot.trigger)} · {autopilot.enabled ? "启用" : "停用"}</small></div>
            </button>
          ))}
          {autopilots.length === 0 && <p>还没有 Autopilot。先建立一条 Manual 规则，即可把固定流程变成可重复分发的任务。</p>}
        </div>
      </aside>

      <form className="squad-editor autopilot-editor" onSubmit={(event) => void submit(event)}>
        <header>
          <div><small>{selected ? "EDIT AUTOPILOT" : "NEW AUTOPILOT"}</small><h3>{selected?.name ?? "建立固定触发规则"}</h3></div>
          <span className={draft.enabled ? "is-enabled" : ""}>{draft.enabled ? "ACTIVE" : "PAUSED"}</span>
        </header>
        <div className="squad-editor__scroll autopilot-editor__scroll">
          <section className="autopilot-project-lock">
            <div><small>BOUND PROJECT</small><strong>{project.name}</strong><span>{project.cwd}</span></div>
            <p>每次触发都在这个项目中新建独立任务，不复用旧任务状态。</p>
          </section>

          <div className="squad-editor__identity autopilot-identity">
            <label className="kanban-field"><span>规则名称</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：手动发布检查" /></label>
            <label className="autopilot-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span />启用规则</label>
          </div>

          <section className="autopilot-trigger-section">
            <div><small>01 / TRIGGER</small><h4>选择触发方式</h4></div>
            <div className="autopilot-trigger-grid" role="tablist" aria-label="Autopilot 触发方式">
              {(["manual", "schedule", "webhook"] as const).map((kind) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={draft.triggerKind === kind}
                  className={draft.triggerKind === kind ? "is-selected" : ""}
                  disabled={Boolean(selected && selected.trigger.kind !== kind)}
                  key={kind}
                  onClick={() => update("triggerKind", kind)}
                >
                  {kind === "manual" ? <Play size={14} /> : kind === "schedule" ? <Clock3 size={14} /> : <Webhook size={14} />}
                  <strong>{kind === "manual" ? "Manual" : kind === "schedule" ? "Schedule" : "Webhook"}</strong>
                  <small>{kind === "manual" ? "按需运行" : kind === "schedule" ? "应用打开时" : "本机回调"}</small>
                </button>
              ))}
            </div>
            {draft.triggerKind === "schedule" && (
              <>
                <div className="autopilot-schedule-fields">
                  <label className="kanban-field"><span>间隔（分钟）</span><input type="number" min="1" step="1" value={draft.intervalMinutes} onChange={(event) => update("intervalMinutes", event.target.value)} /></label>
                  <label className="kanban-field"><span>{selected ? "下次运行" : "首次运行"}</span><input type="datetime-local" value={draft.nextRunAt} onChange={(event) => update("nextRunAt", event.target.value)} /></label>
                </div>
                <p className="autopilot-schedule-note"><Clock3 size={13} />仅在 Stella 应用打开期间运行；停机期间到期的计划会记录为 missed，不会批量补跑。</p>
              </>
            )}
            {draft.triggerKind === "webhook" && (
              <div className={`autopilot-webhook-runtime is-${webhookStatus?.state ?? "stopped"}`}>
                <header>
                  <span><Radio size={13} />{webhookStatus?.state === "listening" ? "LISTENING" : webhookStatus?.state === "error" ? "BIND ERROR" : "STOPPED"}</span>
                  <small>{webhookStatus?.host ?? "127.0.0.1"}:{webhookStatus?.port ?? 43127}</small>
                </header>
                {webhookUrl ? (
                  <div><code>{webhookUrl}</code><button type="button" aria-label="复制 Webhook URL" onClick={() => void copyWebhookUrl()}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "已复制" : "复制 URL"}</button></div>
                ) : <p>保存规则后会生成不可猜测的随机 token 和完整本机 URL。</p>}
                {webhookStatus?.error && <p>{webhookStatus.error}</p>}
              </div>
            )}
          </section>

          <section className="autopilot-task-section">
            <div><small>02 / TASK TEMPLATE</small><h4>定义每次生成的任务</h4></div>
            <label className="kanban-field"><span>任务标题</span><input value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="每次运行生成的新任务标题" /></label>
            <label className="kanban-field"><span>任务说明</span><textarea rows={4} value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="Agent 每次都会收到的固定上下文" /></label>
            <label className="kanban-field"><span>验收标准</span><textarea rows={3} value={draft.acceptanceCriteria} onChange={(event) => update("acceptanceCriteria", event.target.value)} placeholder="如何判断这一票完成" /></label>
            <div className="autopilot-task-grid">
              <label className="kanban-field"><span>优先级</span><select value={draft.priority} onChange={(event) => update("priority", event.target.value as TaskPriority)}>{TASK_PRIORITIES.map((priority) => <option value={priority} key={priority}>{priority}</option>)}</select></label>
              <label className="kanban-field"><span>执行目标</span><select aria-label="执行目标" value={draft.target} onChange={(event) => update("target", event.target.value)}>
                <optgroup label="固定工作流">{catalog.workflows.map((workflow) => <option value={`workflow:${workflow.id}`} key={workflow.id}>{workflow.shortName}</option>)}</optgroup>
                <optgroup label="单 Agent">{catalog.agents.map((agent) => <option value={`agent:${agent.id}`} key={agent.id}>{agent.name} · @{agent.id}</option>)}</optgroup>
                {squads.length > 0 && <optgroup label="动态 Squad">{squads.map((squad) => <option value={`squad:${squad.id}`} key={squad.id}>{squad.name}</option>)}</optgroup>}
              </select></label>
            </div>
          </section>

          {selected && (
            <section className="autopilot-audit">
              <div><small>03 / AUDIT</small><h4>最近触发记录</h4></div>
              {selectedRuns.slice(0, 8).map((run) => (
                <article className={`is-${run.status}`} key={run.id}>
                  <span>{runLabel(run.status)}</span>
                  <div><strong>{new Date(run.startedAt).toLocaleString()}</strong><small>{run.taskId ? `Task ${run.taskId}` : "未生成任务"}</small>{run.error && <p>{run.error}</p>}</div>
                </article>
              ))}
              {selectedRuns.length === 0 && <p className="autopilot-audit__empty">尚未触发。保存后点击“运行一次”即可生成第一条审计记录。</p>}
            </section>
          )}
        </div>

        {error && <p className="kanban-form-error" role="alert">{error}</p>}
        <footer className="squad-editor__actions autopilot-editor__actions">
          {selected && (!confirmDelete
            ? <button type="button" className="button-danger-soft" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={13} />删除</button>
            : <button type="button" className="button-danger-soft" disabled={busy} onClick={() => void onDelete(selected.id).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}><Trash2 size={13} />确认删除</button>)}
          <span />
          {selected?.trigger.kind === "manual" && <button type="button" className="button-secondary" disabled={busy || !selected.enabled} onClick={() => void triggerNow()}><Play size={13} />运行一次</button>}
          <button type="submit" className="button-primary" disabled={busy}><Save size={13} />{busy ? "处理中…" : selected ? "保存规则" : "创建规则"}</button>
        </footer>
      </form>
    </div>
  );
}

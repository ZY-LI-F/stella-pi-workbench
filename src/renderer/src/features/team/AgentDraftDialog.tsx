import { useState, type FormEvent } from "react";
import { Bot, Eye, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import type { ProjectMeta } from "@shared/contracts";
import type { AgentThinkingLevel, CreateProjectAgentInput, ProjectAgentDefinition, UpdateProjectAgentInput, WorkspaceAccess } from "@shared/kanban";
import { Modal } from "../../components/Modal";

interface AgentDraftDialogProps {
  readonly project: ProjectMeta;
  readonly agent?: ProjectAgentDefinition;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCreate: (input: CreateProjectAgentInput) => Promise<void>;
  readonly onUpdate: (input: UpdateProjectAgentInput) => Promise<void>;
  readonly onDelete: (agentId: string) => Promise<void>;
}

const READ_TOOLS = Object.freeze(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = Object.freeze([...READ_TOOLS, "bash", "edit", "write"]);
const THINKING: readonly AgentThinkingLevel[] = Object.freeze(["low", "medium", "high", "xhigh"]);

export function AgentDraftDialog({ project, agent, busy, onClose, onCreate, onUpdate, onDelete }: AgentDraftDialogProps) {
  const [name, setName] = useState(agent?.name ?? "");
  const [callsign, setCallsign] = useState(agent?.callsign ?? "");
  const [responsibility, setResponsibility] = useState(agent?.responsibility ?? "");
  const [instructions, setInstructions] = useState(agent?.instructions ?? "");
  const [workspaceAccess, setWorkspaceAccess] = useState<WorkspaceAccess>(agent?.workspaceAccess ?? "read");
  const [thinking, setThinking] = useState<AgentThinkingLevel>(agent?.thinking ?? "high");
  const [skills, setSkills] = useState((agent?.requiredSkills ?? []).join(", "));
  const [writeConfirmed, setWriteConfirmed] = useState(agent?.workspaceAccess !== "write");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const draft = (): CreateProjectAgentInput => Object.freeze({
    name,
    callsign,
    responsibility,
    instructions,
    workspaceAccess,
    allowedTools: workspaceAccess === "write" ? WRITE_TOOLS : READ_TOOLS,
    requiredSkills: skills.split(",").map((value) => value.trim()).filter(Boolean),
    thinking,
    disableExtensions: true,
    disableSkills: !skills.trim(),
    disablePromptTemplates: true,
    projectPath: project.cwd,
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (workspaceAccess === "write" && !writeConfirmed) {
      setError("请先确认该 Agent 可以修改当前项目");
      return;
    }
    setError("");
    try {
      if (agent) await onUpdate({ ...draft(), agentId: agent.id });
      else await onCreate(draft());
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Modal title={agent ? "编辑项目 Agent" : "创建项目 Agent"} eyebrow="AGENT DRAFT · EXPLICIT CONFIRMATION" onClose={onClose} className="agent-draft-dialog">
      <form onSubmit={(event) => void submit(event)}>
        <div className="agent-draft__project"><Bot size={15} /><span><strong>{project.name}</strong><small>仅在此项目的 Team Chat 与任务目标中可用</small></span></div>
        <div className="agent-draft__row">
          <label className="kanban-field"><span>名称 <i>必填</i></span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：数据分析师" /></label>
          <label className="kanban-field"><span>呼号 <i>必填</i></span><input value={callsign} onChange={(event) => setCallsign(event.target.value.toLocaleUpperCase())} placeholder="DATA" /></label>
        </div>
        <label className="kanban-field"><span>职责 <i>必填</i></span><textarea rows={2} value={responsibility} onChange={(event) => setResponsibility(event.target.value)} placeholder="这个 Agent 负责什么、明确不负责什么" /></label>
        <label className="kanban-field"><span>固定指令 <i>必填</i></span><textarea rows={5} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="事实要求、交付格式、验证方式与禁止行为" /></label>
        <div className="agent-draft__row">
          <fieldset className="agent-draft__access"><legend>项目权限</legend>{(["read", "write"] as const).map((access) => <button type="button" key={access} className={workspaceAccess === access ? "is-selected" : ""} onClick={() => { setWorkspaceAccess(access); setWriteConfirmed(access === "read"); }}>{access === "read" ? <Eye size={14} /> : <ShieldCheck size={14} />}<span><strong>{access === "read" ? "只读" : "可写"}</strong><small>{access === "read" ? "read / grep / find / ls" : "包含 bash / edit / write"}</small></span></button>)}</fieldset>
          <label className="kanban-field"><span>推理强度</span><select value={thinking} onChange={(event) => setThinking(event.target.value as AgentThinkingLevel)}>{THINKING.map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
        </div>
        <label className="kanban-field"><span>必需 Skills <small>逗号分隔；执行前必须真实可发现</small></span><input value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="例如：target-evidence, report-writing" /></label>
        {workspaceAccess === "write" && <label className="agent-draft__write-confirm"><input type="checkbox" checked={writeConfirmed} onChange={(event) => setWriteConfirmed(event.target.checked)} /><ShieldCheck size={15} /><span><strong>我确认允许该 Agent 修改 {project.name}</strong><small>每次执行仍受任务范围、项目写入席位和真实 Pi Runtime 约束。</small></span></label>}
        <div className="agent-draft__protocol"><Sparkles size={14} /><span>创建后可用 <code>@{callsign || "CALLSIGN"}</code> 直接委派，也可由 <code>@lead</code> 在结构化计划中选择。</span></div>
        {error && <p className="kanban-form-error" role="alert">{error}</p>}
        <div className="modal-actions agent-draft__actions">
          {agent && (!confirmDelete
            ? <button type="button" className="button-danger-soft" onClick={() => setConfirmDelete(true)}><Trash2 size={13} />删除</button>
            : <button type="button" className="button-danger-soft" disabled={busy} onClick={() => void onDelete(agent.id).then(onClose).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}><Trash2 size={13} />确认删除</button>)}
          <span />
          <button type="button" className="button-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="button-primary" disabled={busy || !name.trim() || !callsign.trim() || !responsibility.trim() || !instructions.trim()}>{busy ? "保存中…" : agent ? "保存 Agent" : "创建 Agent"}</button>
        </div>
      </form>
    </Modal>
  );
}

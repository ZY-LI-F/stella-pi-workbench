import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bot, Check, Network, Plus, Save, Trash2, Users } from "lucide-react";
import type { ProjectMeta } from "@shared/contracts";
import type {
  AgentDefinition,
  Autopilot,
  AutopilotRun,
  AutomationRuntimeStatus,
  CreateAutopilotInput,
  CreateSquadInput,
  KanbanTask,
  OrchestrationCatalog,
  Squad,
  UpdateAutopilotInput,
  UpdateSquadInput,
} from "@shared/kanban";
import { Modal } from "../../components/Modal";
import { AutopilotPanel } from "./AutopilotPanel";

interface AutomationStudioDialogProps {
  readonly catalog: OrchestrationCatalog;
  readonly project: ProjectMeta;
  readonly squads: readonly Squad[];
  readonly tasks: readonly KanbanTask[];
  readonly autopilots: readonly Autopilot[];
  readonly autopilotRuns: readonly AutopilotRun[];
  readonly webhookStatus?: AutomationRuntimeStatus["webhook"];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCreateSquad: (input: CreateSquadInput) => Promise<void>;
  readonly onUpdateSquad: (input: UpdateSquadInput) => Promise<void>;
  readonly onDeleteSquad: (squadId: string) => Promise<void>;
  readonly onCreateAutopilot: (input: CreateAutopilotInput) => Promise<void>;
  readonly onUpdateAutopilot: (input: UpdateAutopilotInput) => Promise<void>;
  readonly onDeleteAutopilot: (autopilotId: string) => Promise<void>;
  readonly onTriggerAutopilot: (autopilotId: string) => Promise<void>;
  readonly onCopy: (value: string) => Promise<void>;
}

interface SquadDraft {
  readonly name: string;
  readonly description: string;
  readonly leaderAgentId: string;
  readonly memberAgentIds: readonly string[];
  readonly leaderInstructions: string;
}

const DEFAULT_INSTRUCTIONS = "先理解任务并完成 Leader 分析。仅在确实需要成员继续执行时，在最终回复中使用成员的精确 @mention；不要假装成员已经执行。";

function emptyDraft(agents: readonly AgentDefinition[]): SquadDraft {
  return Object.freeze({
    name: "",
    description: "",
    leaderAgentId: agents[0]?.id ?? "",
    memberAgentIds: Object.freeze(agents[1] ? [agents[1].id] : []),
    leaderInstructions: DEFAULT_INSTRUCTIONS,
  });
}

function squadDraft(squad: Squad): SquadDraft {
  return Object.freeze({
    name: squad.name,
    description: squad.description,
    leaderAgentId: squad.leaderAgentId,
    memberAgentIds: Object.freeze([...squad.memberAgentIds]),
    leaderInstructions: squad.leaderInstructions,
  });
}

export function AutomationStudioDialog({
  catalog,
  project,
  squads,
  tasks,
  autopilots,
  autopilotRuns,
  webhookStatus,
  busy,
  onClose,
  onCreateSquad,
  onUpdateSquad,
  onDeleteSquad,
  onCreateAutopilot,
  onUpdateAutopilot,
  onDeleteAutopilot,
  onTriggerAutopilot,
  onCopy,
}: AutomationStudioDialogProps) {
  const squadAgents = useMemo(() => catalog.agents.filter((agent) => agent.id !== "lead"), [catalog.agents]);
  const [activeTab, setActiveTab] = useState<"squads" | "autopilots">("squads");
  const [selectedId, setSelectedId] = useState<string | "new">(squads[0]?.id ?? "new");
  const selected = selectedId === "new" ? undefined : squads.find((squad) => squad.id === selectedId);
  const [draft, setDraft] = useState<SquadDraft>(() => selected ? squadDraft(selected) : emptyDraft(squadAgents));
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 仅在切换选择或所选 Squad 真正更新时重置草稿，避免看板快照抹掉输入。
  const selectedUpdatedAt = selected?.updatedAt;
  useEffect(() => {
    setDraft(selected ? squadDraft(selected) : emptyDraft(squadAgents));
    setError("");
    setConfirmDelete(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 刻意只依赖选择标识与 updatedAt：看板快照的身份抖动不应抹掉用户草稿
  }, [selectedId, selectedUpdatedAt]);

  const leader = squadAgents.find((agent) => agent.id === draft.leaderAgentId);
  const members = useMemo(() => squadAgents.filter((agent) => draft.memberAgentIds.includes(agent.id)), [draft.memberAgentIds, squadAgents]);

  const update = <K extends keyof SquadDraft>(key: K, value: SquadDraft[K]) => {
    setDraft((current) => Object.freeze({ ...current, [key]: value }));
  };

  const chooseLeader = (agentId: string) => {
    setDraft((current) => Object.freeze({
      ...current,
      leaderAgentId: agentId,
      memberAgentIds: Object.freeze(current.memberAgentIds.filter((id) => id !== agentId)),
    }));
  };

  const toggleMember = (agentId: string) => {
    setDraft((current) => Object.freeze({
      ...current,
      memberAgentIds: current.memberAgentIds.includes(agentId)
        ? Object.freeze(current.memberAgentIds.filter((id) => id !== agentId))
        : Object.freeze([...current.memberAgentIds, agentId]),
    }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const input: CreateSquadInput = Object.freeze({ ...draft });
    try {
      if (selected) await onUpdateSquad(Object.freeze({ ...input, squadId: selected.id }));
      else await onCreateSquad(input);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Modal title="自动化工作室" eyebrow="STELLA AUTOMATION STUDIO" onClose={onClose} className="automation-studio">
      <div className="automation-studio__tabs" role="tablist" aria-label="自动化工作室视图">
        <button type="button" className={activeTab === "squads" ? "is-active" : ""} role="tab" aria-selected={activeTab === "squads"} onClick={() => setActiveTab("squads")}><Users size={14} />动态 Squad</button>
        <button type="button" className={activeTab === "autopilots" ? "is-active" : ""} role="tab" aria-selected={activeTab === "autopilots"} onClick={() => setActiveTab("autopilots")}><Network size={14} />Autopilot</button>
      </div>
      {activeTab === "squads" ? <div className="automation-studio__layout">
        <aside className="squad-directory">
          <header><div><small>SQUADS</small><strong>动态小队</strong></div><button type="button" aria-label="创建 Squad" onClick={() => setSelectedId("new")}><Plus size={14} /></button></header>
          <div>
            {squads.map((squad) => {
              const squadLeader = squadAgents.find((agent) => agent.id === squad.leaderAgentId);
              return (
                <button type="button" className={selectedId === squad.id ? "is-selected" : ""} key={squad.id} onClick={() => setSelectedId(squad.id)}>
                  <span><Users size={13} /></span><div><strong>{squad.name}</strong><small>{squadLeader?.name ?? squad.leaderAgentId} · {squad.memberAgentIds.length} members</small></div>
                </button>
              );
            })}
            {squads.length === 0 && <p>还没有 Squad。创建一个 Leader + members 组合后，任务即可使用动态委派。</p>}
          </div>
        </aside>

        <form className="squad-editor" onSubmit={(event) => void submit(event)}>
          <header><div><small>{selected ? "EDIT SQUAD" : "NEW SQUAD"}</small><h3>{selected ? selected.name : "建立动态分发小队"}</h3></div><span>{leader ? `Leader @${leader.id}` : "未选择 Leader"}</span></header>
          <div className="squad-editor__scroll">
            <div className="squad-editor__identity">
              <label className="kanban-field"><span>Squad 名称</span><input value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：交付突击队" /></label>
              <label className="kanban-field"><span>用途说明</span><input value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="这个小队擅长完成什么" /></label>
            </div>

            <section className="squad-role-section">
              <div><small>01 / LEADER</small><h4>选择 Squad Leader</h4><p>Leader 先执行并决定是否通过 @mention 委派成员。</p></div>
              <div className="squad-agent-grid">
                {squadAgents.map((agent) => (
                  <button type="button" className={draft.leaderAgentId === agent.id ? "is-selected" : ""} key={agent.id} onClick={() => chooseLeader(agent.id)}>
                    <span><Bot size={13} /></span><div><strong>{agent.name}</strong><small>@{agent.id} · {agent.callsign}</small></div>{draft.leaderAgentId === agent.id && <Check size={13} />}
                  </button>
                ))}
              </div>
            </section>

            <section className="squad-role-section">
              <div><small>02 / MEMBERS</small><h4>选择可委派成员</h4><p>最终输出中的精确 @id 或 @CALLSIGN 会生成真实子 AgentTask。</p></div>
              <div className="squad-agent-grid">
                {squadAgents.filter((agent) => agent.id !== draft.leaderAgentId).map((agent) => (
                  <button type="button" className={draft.memberAgentIds.includes(agent.id) ? "is-selected" : ""} key={agent.id} onClick={() => toggleMember(agent.id)}>
                    <span><Bot size={13} /></span><div><strong>{agent.name}</strong><small>@{agent.id} · {agent.callsign}</small></div>{draft.memberAgentIds.includes(agent.id) && <Check size={13} />}
                  </button>
                ))}
              </div>
            </section>

            <label className="kanban-field squad-leader-prompt"><span>Leader 固定指令</span><textarea rows={5} value={draft.leaderInstructions} onChange={(event) => update("leaderInstructions", event.target.value)} /></label>

            <div className="squad-protocol-preview">
              <small>DELEGATION PROTOCOL</small>
              <div><span className="is-leader">@{leader?.id ?? "leader"}</span><i />{members.map((agent) => <span key={agent.id}>@{agent.id}</span>)}</div>
              <p>Leader 的产物先持久化；命中的成员按出现顺序串行执行，父项等待全部子项终结。</p>
            </div>
          </div>
          {error && <p className="kanban-form-error" role="alert">{error}</p>}
          <footer className="squad-editor__actions">
            {selected && (!confirmDelete
              ? <button type="button" className="button-danger-soft" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={13} />删除</button>
              : <button type="button" className="button-danger-soft" disabled={busy} onClick={() => void onDeleteSquad(selected.id).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))}><Trash2 size={13} />确认删除</button>)}
            <button type="submit" className="button-primary" disabled={busy}><Save size={13} />{busy ? "保存中…" : selected ? "保存 Squad" : "创建 Squad"}</button>
          </footer>
        </form>
      </div> : (
        <AutopilotPanel
          project={project}
          catalog={catalog}
          squads={squads}
          tasks={tasks}
          autopilots={autopilots}
          runs={autopilotRuns}
          webhookStatus={webhookStatus}
          busy={busy}
          onCreate={onCreateAutopilot}
          onUpdate={onUpdateAutopilot}
          onDelete={onDeleteAutopilot}
          onTrigger={onTriggerAutopilot}
          onCopy={onCopy}
        />
      )}
    </Modal>
  );
}

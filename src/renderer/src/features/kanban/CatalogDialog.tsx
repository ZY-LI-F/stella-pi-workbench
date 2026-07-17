import { useState } from "react";
import { Bot, CheckCircle2, Eye, GitBranch, ShieldCheck, Users, Workflow } from "lucide-react";
import type { OrchestrationCatalog } from "@shared/kanban";
import { Modal } from "../../components/Modal";

type CatalogTab = "agents" | "teams" | "workflows";

export function CatalogDialog({ catalog, onClose }: { readonly catalog: OrchestrationCatalog; readonly onClose: () => void }) {
  const [tab, setTab] = useState<CatalogTab>("agents");
  return (
    <Modal title="固定编排目录" eyebrow="ORCHESTRATION CATALOG" onClose={onClose} className="catalog-dialog">
      <div className="catalog-tabs" role="tablist" aria-label="目录类型">
        <button type="button" role="tab" aria-selected={tab === "agents"} className={tab === "agents" ? "is-active" : ""} onClick={() => setTab("agents")}><Bot size={15} />Agent</button>
        <button type="button" role="tab" aria-selected={tab === "teams"} className={tab === "teams" ? "is-active" : ""} onClick={() => setTab("teams")}><Users size={15} />团队</button>
        <button type="button" role="tab" aria-selected={tab === "workflows"} className={tab === "workflows" ? "is-active" : ""} onClick={() => setTab("workflows")}><Workflow size={15} />流程</button>
      </div>

      <div className="catalog-body">
        {tab === "agents" && <div className="catalog-grid">
          {catalog.agents.map((agent) => (
            <article className="catalog-card" key={agent.id}>
              <div className="catalog-card__top"><span className="agent-callsign">{agent.callsign}</span><small>v{agent.version}</small></div>
              <h3>{agent.name}</h3>
              <p>{agent.responsibility}</p>
              <div className="catalog-card__meta">
                <span>{agent.workspaceAccess === "write" ? <ShieldCheck size={12} /> : <Eye size={12} />}{agent.workspaceAccess === "write" ? "可写项目" : "只读项目"}</span>
                <span>{agent.thinking} thinking</span>
              </div>
              <div className="tool-chips">{agent.allowedTools.map((tool) => <code key={tool}>{tool}</code>)}</div>
            </article>
          ))}
        </div>}

        {tab === "teams" && <div className="catalog-stack">
          {catalog.teams.map((team) => (
            <article className="team-card" key={team.id}>
              <div><small>TEAM · v{team.version}</small><h3>{team.name}</h3><p>{team.summary}</p></div>
              <div className="team-rail">
                {team.roles.map((role, index) => {
                  const agent = catalog.agents.find((candidate) => candidate.id === role.agentId);
                  return <div key={role.id}><span>{index + 1}</span><strong>{role.label}</strong><small>{agent?.name ?? role.agentId}</small></div>;
                })}
              </div>
            </article>
          ))}
        </div>}

        {tab === "workflows" && <div className="catalog-stack">
          {catalog.workflows.map((workflow) => (
            <article className="workflow-card" key={workflow.id}>
              <div className="workflow-card__header"><span><Workflow size={16} /></span><div><small>WORKFLOW · v{workflow.version}</small><h3>{workflow.name}</h3><p>{workflow.summary}</p></div></div>
              <div className="workflow-sequence">
                {workflow.steps.map((step, index) => (
                  <div key={step.id} className={step.kind === "human-gate" ? "is-gate" : ""}>
                    <span>{step.kind === "human-gate" ? <CheckCircle2 size={13} /> : <GitBranch size={13} />}</span>
                    <strong>{step.name}</strong>
                    <small>{step.kind === "human-gate" ? "人工关卡" : catalog.agents.find((agent) => agent.id === step.agentId)?.name}</small>
                    {index < workflow.steps.length - 1 && <i />}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>}
      </div>
    </Modal>
  );
}

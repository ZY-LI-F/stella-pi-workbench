import { useMemo, useState, type KeyboardEvent } from "react";
import { Ban, Check, Circle, ExternalLink, GitBranch, MessagesSquare, Pause, Play, ShieldCheck, XCircle } from "lucide-react";
import type { WorkflowRun } from "@shared/kanban";
import { projectWorkflowDag, type WorkflowDagNode } from "@shared/workflow-dag";
import { ArtifactDetails } from "./ArtifactDetails";
import { ACCEPTANCE_LABEL, EXECUTION_STATUS_LABEL } from "./kanban-format";

interface WorkflowDagProps {
  readonly workflowExpected: boolean;
  readonly runs: readonly WorkflowRun[];
  readonly busy: boolean;
  readonly executionEnabled: boolean;
  readonly onRevealPath: (path: string) => void;
  readonly onContinueInPi: (sessionPath: string) => Promise<void>;
  readonly onError: (message: string) => void;
}

function statusIcon(status: WorkflowDagNode["status"]) {
  if (status === "succeeded") return <Check size={14} />;
  if (status === "failed") return <XCircle size={14} />;
  if (status === "interrupted") return <Ban size={14} />;
  if (status === "waiting") return <Pause size={14} />;
  if (status === "running") return <Play size={14} />;
  return <Circle size={12} />;
}

function moveNodeFocus(event: KeyboardEvent<HTMLButtonElement>, onSelect: (nodeId: string) => void) {
  const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
    : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1
      : 0;
  if (direction === 0) return;
  const graph = event.currentTarget.closest(".workflow-dag__canvas");
  const nodes = graph ? [...graph.querySelectorAll<HTMLButtonElement>(".workflow-dag-node")] : [];
  const index = nodes.indexOf(event.currentTarget);
  const target = nodes[index + direction];
  if (!target) return;
  event.preventDefault();
  target.focus();
  onSelect(target.dataset.nodeId ?? "");
}

export function WorkflowDag({ workflowExpected, runs, busy, executionEnabled, onRevealPath, onContinueInPi, onError }: WorkflowDagProps) {
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [selectedNodeId, setSelectedNodeId] = useState<string>();
  const sortedRuns = useMemo(() => [...runs].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)), [runs]);
  const run = sortedRuns.find((candidate) => candidate.id === selectedRunId) ?? sortedRuns[0];
  const projection = useMemo(() => run ? projectWorkflowDag(run) : undefined, [run]);
  const selectedNode = projection?.nodes.find((node) => node.id === selectedNodeId) ?? projection?.nodes[0];

  const continueInPi = async (sessionPath: string) => {
    try {
      await onContinueInPi(sessionPath);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="workflow-dag" aria-label="Workflow 可视化 DAG">
      <header className="workflow-dag__header">
        <div><small>EXECUTION DAG</small><h3>流程依赖图</h3></div>
        {run && (
          <label>
            <span className="sr-only">选择历史 Run</span>
            <select value={run.id} onChange={(event) => { setSelectedRunId(event.target.value); setSelectedNodeId(undefined); }}>
              {sortedRuns.map((candidate) => <option value={candidate.id} key={candidate.id}>RUN {candidate.id.slice(0, 8)} · {EXECUTION_STATUS_LABEL[candidate.status] ?? candidate.status}</option>)}
            </select>
          </label>
        )}
      </header>

      {!workflowExpected ? (
        <div className="workflow-dag__empty"><GitBranch size={19} /><strong>当前任务不是 Workflow</strong><p>单 Agent 与 Squad 使用 AgentTask 委派轨迹，不生成伪造的 Workflow DAG。</p></div>
      ) : !run || !projection ? (
        <div className="workflow-dag__empty"><GitBranch size={19} /><strong>尚无持久化 Run</strong><p>分发 Workflow 后，DAG 将从该次执行快照生成。</p></div>
      ) : projection.nodes.length === 0 ? (
        <div className="workflow-dag__empty"><GitBranch size={19} /><strong>Workflow 快照没有步骤</strong><p>该历史 Run 没有可投影的节点。</p></div>
      ) : (
        <>
          <div className="workflow-dag__run-truth">
            <code title={run.id}>RUN {run.id.slice(0, 8)}</code>
            <span className={`execution-chip execution-chip--${run.status}`}>{EXECUTION_STATUS_LABEL[run.status] ?? run.status}</span>
            <span className={`acceptance-chip acceptance-chip--${run.acceptance}`}>{ACCEPTANCE_LABEL[run.acceptance]}</span>
          </div>
          <div className="workflow-dag__viewport">
            <div className="workflow-dag__canvas" role="group" aria-label={`${projection.workflowName} 的步骤依赖`}>
              {projection.nodes.map((node, index) => (
                <div className="workflow-dag__segment" key={node.id}>
                  <button
                    type="button"
                    className={`workflow-dag-node workflow-dag-node--${node.status} ${selectedNode?.id === node.id ? "is-selected" : ""}`}
                    aria-pressed={selectedNode?.id === node.id}
                    aria-label={`${node.name}，${EXECUTION_STATUS_LABEL[node.status] ?? node.status}`}
                    data-node-id={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                    onKeyDown={(event) => moveNodeFocus(event, setSelectedNodeId)}
                  >
                    <span>{statusIcon(node.status)}</span>
                    <small>{node.kind === "human-gate" ? "HUMAN GATE" : node.agent?.callsign ?? "AGENT"}</small>
                    <strong>{node.name}</strong>
                    <em>{EXECUTION_STATUS_LABEL[node.status] ?? node.status}</em>
                  </button>
                  {projection.edges[index] && (
                    <div className="workflow-dag-edge" data-edge-id={projection.edges[index]?.id} aria-hidden="true"><i /><span>›</span></div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {selectedNode && (
            <article className={`workflow-dag-detail workflow-dag-detail--${selectedNode.status}`}>
              <header>
                <span>{selectedNode.kind === "human-gate" ? <ShieldCheck size={15} /> : <GitBranch size={15} />}</span>
                <div><small>{selectedNode.kind === "human-gate" ? "人工关卡" : selectedNode.agent ? `${selectedNode.agent.name} · @${selectedNode.agent.id}` : "Agent snapshot 缺失"}</small><h4>{selectedNode.name}</h4></div>
                <code title={selectedNode.stepRunId ?? selectedNode.definitionId}>STEP {(selectedNode.stepRunId ?? selectedNode.definitionId).slice(0, 8)}</code>
              </header>
              <p>{selectedNode.summary}</p>
              <dl><dt>目标 / 指令</dt><dd>{selectedNode.objective}</dd></dl>
              {selectedNode.error && <div className="workflow-dag-detail__error" role="alert"><XCircle size={13} />{selectedNode.error}</div>}
              {selectedNode.artifact && <ArtifactDetails artifact={selectedNode.artifact} onRevealPath={onRevealPath} />}
              {selectedNode.sessionPath && (
                <div className="workflow-dag-detail__actions">
                  <button type="button" className="button-secondary" onClick={() => onRevealPath(selectedNode.sessionPath ?? "")}><ExternalLink size={12} />文件位置</button>
                  <button type="button" className="button-secondary" disabled={busy || !executionEnabled} onClick={() => void continueInPi(selectedNode.sessionPath ?? "")}><MessagesSquare size={12} />在 Pi 中继续</button>
                </div>
              )}
            </article>
          )}
        </>
      )}
    </section>
  );
}

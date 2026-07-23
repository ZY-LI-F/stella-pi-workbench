import type {
  AgentArtifact,
  AgentDefinition,
  StepRunStatus,
  WorkflowRun,
  WorkflowStepDefinition,
} from "./kanban";

export interface WorkflowDagNode {
  readonly id: string;
  readonly definitionId: string;
  readonly stepRunId?: string;
  readonly kind: WorkflowStepDefinition["kind"];
  readonly name: string;
  readonly summary: string;
  readonly objective: string;
  readonly status: StepRunStatus;
  readonly agent?: AgentDefinition;
  readonly artifact?: AgentArtifact;
  readonly error?: string;
  readonly sessionPath?: string;
}

export interface WorkflowDagEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface WorkflowDagProjection {
  readonly runId: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly nodes: readonly WorkflowDagNode[];
  readonly edges: readonly WorkflowDagEdge[];
}

function agentForStep(run: WorkflowRun, step: WorkflowStepDefinition): AgentDefinition | undefined {
  if (step.kind !== "agent") return undefined;
  const agent = run.agents.find((candidate) => candidate.id === step.agentId);
  if (!agent) throw new Error(`Workflow Run ${run.id} 的步骤 ${step.id} 缺少 Agent snapshot: ${step.agentId}`);
  return agent;
}

export function projectWorkflowDag(run: WorkflowRun): WorkflowDagProjection {
  const stepRuns = new Map<string, WorkflowRun["steps"][number]>();
  for (const stepRun of run.steps) {
    if (stepRuns.has(stepRun.stepId)) throw new Error(`Workflow Run ${run.id} 含重复 StepRun: ${stepRun.stepId}`);
    stepRuns.set(stepRun.stepId, stepRun);
  }
  const nodes = run.workflow.steps.map((step): WorkflowDagNode => {
    const stepRun = stepRuns.get(step.id);
    const objective = step.kind === "agent" ? step.objective : step.instructions;
    return Object.freeze({
      id: `step:${step.id}`,
      definitionId: step.id,
      stepRunId: stepRun?.id,
      kind: step.kind,
      name: step.name,
      summary: step.summary,
      objective,
      status: stepRun?.status ?? "pending",
      agent: agentForStep(run, step),
      artifact: stepRun?.artifact ? Object.freeze({ ...stepRun.artifact, startedAt: stepRun.startedAt, completedAt: stepRun.completedAt }) : undefined,
      error: stepRun?.error,
      sessionPath: stepRun?.sessionPath ?? stepRun?.artifact?.sessionPath,
    });
  });
  const edges = nodes.slice(1).map((node, index): WorkflowDagEdge => {
    const previous = nodes[index];
    if (!previous) throw new Error(`Workflow Run ${run.id} 无法生成边 ${index}`);
    return Object.freeze({ id: `edge:${previous.id}->${node.id}`, from: previous.id, to: node.id });
  });
  return Object.freeze({
    runId: run.id,
    workflowId: run.workflow.id,
    workflowName: run.workflow.name,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
  });
}

import type { AgentDefinition, BoardState, OrchestrationCatalog, ProjectAgentDefinition } from "./kanban";

export type AgentPresenceState = "available" | "queued" | "running" | "waiting" | "attention";

export interface AgentPresence {
  readonly agent: AgentDefinition;
  readonly state: AgentPresenceState;
  readonly activeTaskId?: string;
  readonly activeTaskTitle?: string;
  readonly detail: string;
  readonly queuedCount: number;
  readonly workload: number;
  readonly lastSeenAt?: string;
}

interface PresenceSignal {
  readonly state: Exclude<AgentPresenceState, "available">;
  readonly priority: number;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly detail: string;
  readonly updatedAt: string;
}

function isVisibleInProject(agent: AgentDefinition, projectPath?: string): boolean {
  const scoped = agent as Partial<ProjectAgentDefinition>;
  return scoped.projectPath === undefined || projectPath === undefined || scoped.projectPath === projectPath;
}

export function deriveAgentPresences(
  board: BoardState,
  catalog: OrchestrationCatalog,
  projectPath?: string,
): readonly AgentPresence[] {
  const tasks = new Map(board.tasks.map((task) => [task.id, task]));
  const signals = new Map<string, PresenceSignal[]>();
  const push = (agentId: string, signal: PresenceSignal): void => {
    signals.set(agentId, [...signals.get(agentId) ?? [], signal]);
  };

  for (const agentTask of board.agentTasks) {
    const task = tasks.get(agentTask.taskId);
    if (!task || (projectPath && task.projectPath !== projectPath)) continue;
    if (agentTask.status === "running") push(agentTask.agentSnapshot.id, { state: "running", priority: 50, taskId: task.id, taskTitle: task.title, detail: "正在执行 AgentTask", updatedAt: agentTask.updatedAt });
    else if (agentTask.status === "waiting_children" || agentTask.status === "waiting_human") push(agentTask.agentSnapshot.id, { state: "waiting", priority: 40, taskId: task.id, taskTitle: task.title, detail: agentTask.status === "waiting_human" ? "等待用户回复" : "等待成员报告", updatedAt: agentTask.updatedAt });
    else if (agentTask.status === "queued") push(agentTask.agentSnapshot.id, { state: "queued", priority: 30, taskId: task.id, taskTitle: task.title, detail: "已进入执行队列", updatedAt: agentTask.updatedAt });
    else if ((agentTask.status === "failed" || agentTask.status === "interrupted") && task.stage === "blocked") push(agentTask.agentSnapshot.id, { state: "attention", priority: 20, taskId: task.id, taskTitle: task.title, detail: agentTask.error ?? "执行需要处理", updatedAt: agentTask.updatedAt });
  }

  for (const run of board.runs) {
    const task = tasks.get(run.taskId);
    if (!task || (projectPath && task.projectPath !== projectPath)) continue;
    const firstPendingStepId = run.steps.find((step) => step.status === "pending")?.stepId;
    for (const step of run.steps) {
      if (!step.agentId) continue;
      if (step.status === "running") push(step.agentId, { state: "running", priority: 50, taskId: task.id, taskTitle: task.title, detail: `正在执行「${step.name}」`, updatedAt: run.updatedAt });
      else if (step.status === "pending" && (run.currentStepId === step.stepId || (run.status === "queued" && firstPendingStepId === step.stepId))) push(step.agentId, { state: "queued", priority: 30, taskId: task.id, taskTitle: task.title, detail: `等待执行「${step.name}」`, updatedAt: run.updatedAt });
      else if ((step.status === "failed" || step.status === "interrupted") && task.stage === "blocked") push(step.agentId, { state: "attention", priority: 20, taskId: task.id, taskTitle: task.title, detail: step.error ?? `「${step.name}」需要处理`, updatedAt: run.updatedAt });
    }
  }

  return Object.freeze(catalog.agents
    .filter((agent) => isVisibleInProject(agent, projectPath))
    .map((agent) => {
      const agentSignals = [...signals.get(agent.id) ?? []].sort((left, right) => right.priority - left.priority || Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
      const current = agentSignals[0];
      const activeTaskIds = new Set(agentSignals.filter((signal) => signal.state === "running" || signal.state === "waiting" || signal.state === "queued").map((signal) => signal.taskId));
      return Object.freeze({
        agent,
        state: current?.state ?? "available",
        activeTaskId: current?.taskId,
        activeTaskTitle: current?.taskTitle,
        detail: current?.detail ?? "可接受新任务",
        queuedCount: agentSignals.filter((signal) => signal.state === "queued").length,
        workload: activeTaskIds.size,
        lastSeenAt: current?.updatedAt,
      });
    }));
}

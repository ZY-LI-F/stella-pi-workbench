import type {
  AgentArtifact,
  AgentTask,
  AgentTaskStatus,
  ExecutionAcceptanceStatus,
  KanbanTask,
  StepRunStatus,
  TaskActivity,
  TaskComment,
  WorkflowRun,
  WorkflowRunStatus,
} from "./kanban";

export const TASK_TIMELINE_KINDS = [
  "goal",
  "user-message",
  "agent-output",
  "system-receipt",
  "dispatch-receipt",
  "execution",
  "artifact",
  "review",
] as const;

export type TaskTimelineKind = (typeof TASK_TIMELINE_KINDS)[number];
export type TaskTimelineSource = "task" | "message" | "activity" | "workflow-run" | "workflow-step" | "agent-task";
export type TaskTimelineStatus = WorkflowRunStatus | StepRunStatus | AgentTaskStatus;

export interface TaskTimelineProvenance {
  readonly source: TaskTimelineSource;
  readonly sourceId: string;
  readonly runId?: string;
  readonly stepId?: string;
  readonly agentTaskId?: string;
}

export interface TaskTimelineEntry {
  readonly id: string;
  readonly kind: TaskTimelineKind;
  readonly createdAt: string;
  readonly title: string;
  readonly body?: string;
  readonly detail?: string;
  readonly authorAgentId?: string;
  readonly status?: TaskTimelineStatus;
  readonly acceptance?: ExecutionAcceptanceStatus;
  readonly artifact?: AgentArtifact;
  readonly sessionPath?: string;
  readonly provenance: TaskTimelineProvenance;
}

export interface ProjectTaskTimelineInput {
  readonly task: KanbanTask;
  readonly comments: readonly TaskComment[];
  readonly activities: readonly TaskActivity[];
  readonly runs: readonly WorkflowRun[];
  readonly agentTasks: readonly AgentTask[];
}

const KIND_ORDER = new Map<TaskTimelineKind, number>(TASK_TIMELINE_KINDS.map((kind, index) => [kind, index]));

function freezeProvenance(provenance: TaskTimelineProvenance): TaskTimelineProvenance {
  return Object.freeze({ ...provenance });
}

function entry(value: Omit<TaskTimelineEntry, "provenance"> & { readonly provenance: TaskTimelineProvenance }): TaskTimelineEntry {
  return Object.freeze({ ...value, provenance: freezeProvenance(value.provenance) });
}

function messageEntry(message: TaskComment): TaskTimelineEntry {
  const kind: TaskTimelineKind = message.messageKind === "acceptance"
    ? "review"
    : message.messageKind === "execution-report" || message.author === "agent"
      ? "agent-output"
      : message.author === "user"
        ? "user-message"
        : "system-receipt";
  const title = kind === "review"
    ? "执行验收决定"
    : kind === "agent-output"
      ? message.authorAgentId ? `@${message.authorAgentId} 返回结果` : "Agent 返回结果"
      : kind === "user-message"
        ? "用户补充任务上下文"
        : "Stella 系统消息";
  return entry({
    id: `message:${message.id}`,
    kind,
    createdAt: message.createdAt,
    title,
    body: message.body,
    authorAgentId: message.authorAgentId,
    provenance: {
      source: "message",
      sourceId: message.id,
      runId: message.runId,
      agentTaskId: message.agentTaskId,
    },
  });
}

function activityEntry(activity: TaskActivity): TaskTimelineEntry {
  return entry({
    id: `activity:${activity.id}`,
    kind: activity.kind === "dispatch" ? "dispatch-receipt" : "system-receipt",
    createdAt: activity.createdAt,
    title: activity.summary,
    body: activity.detail,
    provenance: {
      source: "activity",
      sourceId: activity.id,
      runId: activity.runId,
      stepId: activity.stepId,
      agentTaskId: activity.agentTaskId,
    },
  });
}

function runEntries(run: WorkflowRun): readonly TaskTimelineEntry[] {
  const runEntry = entry({
    id: `workflow-run:${run.id}`,
    kind: "execution",
    createdAt: run.updatedAt,
    title: `工作流执行 · ${run.workflow.name}`,
    detail: `Run ${run.id}`,
    status: run.status,
    acceptance: run.acceptance,
    provenance: { source: "workflow-run", sourceId: run.id, runId: run.id },
  });
  const steps = run.steps.flatMap((step): readonly TaskTimelineEntry[] => {
    const stepEntry = entry({
      id: `workflow-step:${step.id}`,
      kind: "execution",
      createdAt: step.completedAt ?? step.startedAt ?? run.startedAt,
      title: `${step.stepKind === "human-gate" ? "人工关卡" : "工作流步骤"} · ${step.name}`,
      body: step.error,
      status: step.status,
      sessionPath: step.sessionPath,
      provenance: { source: "workflow-step", sourceId: step.id, runId: run.id, stepId: step.stepId },
    });
    if (!step.artifact) return Object.freeze([stepEntry]);
    return Object.freeze([
      stepEntry,
      entry({
        id: `workflow-step:${step.id}:artifact`,
        kind: "artifact",
        createdAt: step.completedAt ?? step.startedAt ?? run.startedAt,
        title: step.artifact.title,
        artifact: step.artifact,
        sessionPath: step.artifact.sessionPath ?? step.sessionPath,
        provenance: { source: "workflow-step", sourceId: step.id, runId: run.id, stepId: step.stepId },
      }),
    ]);
  });
  return Object.freeze([runEntry, ...steps]);
}

function agentTaskEntries(agentTask: AgentTask, reportMessageAgentTaskIds: ReadonlySet<string>): readonly TaskTimelineEntry[] {
  const execution = entry({
    id: `agent-task:${agentTask.id}`,
    kind: "execution",
    createdAt: agentTask.updatedAt,
    title: `${agentTask.parentAgentTaskId ? "委派执行" : "Agent 执行"} · ${agentTask.agentSnapshot.name}`,
    body: agentTask.error,
    detail: `@${agentTask.agentSnapshot.id} · ${agentTask.agentSnapshot.workspaceAccess === "write" ? "可写工作区" : "只读工作区"}`,
    status: agentTask.status,
    acceptance: agentTask.parentAgentTaskId ? undefined : agentTask.acceptance,
    sessionPath: agentTask.sessionPath,
    provenance: { source: "agent-task", sourceId: agentTask.id, agentTaskId: agentTask.id },
  });
  if (!agentTask.output || reportMessageAgentTaskIds.has(agentTask.id)) return Object.freeze([execution]);
  return Object.freeze([
    execution,
    entry({
      id: `agent-task:${agentTask.id}:output`,
      kind: "agent-output",
      createdAt: agentTask.completedAt ?? agentTask.updatedAt,
      title: `@${agentTask.agentSnapshot.id} 返回结果`,
      authorAgentId: agentTask.agentSnapshot.id,
      artifact: Object.freeze({
        title: "Agent 最终产物",
        content: agentTask.output,
        sessionPath: agentTask.sessionPath,
        inputTokens: agentTask.inputTokens,
        outputTokens: agentTask.outputTokens,
        cost: agentTask.cost,
      }),
      sessionPath: agentTask.sessionPath,
      provenance: { source: "agent-task", sourceId: agentTask.id, agentTaskId: agentTask.id },
    }),
  ]);
}

function timestamp(value: string, entryId: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error(`Task timeline 条目 ${entryId} 的时间无效: ${value}`);
  return result;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function projectTaskTimeline(input: ProjectTaskTimelineInput): readonly TaskTimelineEntry[] {
  const reportMessageAgentTaskIds = new Set(
    input.comments
      .filter((message) => message.messageKind === "execution-report" && message.agentTaskId)
      .map((message) => message.agentTaskId as string),
  );
  const goal = entry({
    id: `task:${input.task.id}`,
    kind: "goal",
    createdAt: input.task.createdAt,
    title: "任务目标已创建",
    body: input.task.description || "未填写补充说明。",
    detail: `验收标准：${input.task.acceptanceCriteria || "未填写补充标准。"}`,
    sessionPath: input.task.sourcePiSessionPath,
    provenance: { source: "task", sourceId: input.task.id },
  });
  const entries = [
    goal,
    ...input.comments.map(messageEntry),
    ...input.activities.map(activityEntry),
    ...input.runs.flatMap(runEntries),
    ...input.agentTasks.flatMap((agentTask) => agentTaskEntries(agentTask, reportMessageAgentTaskIds)),
  ];
  for (const item of entries) timestamp(item.createdAt, item.id);
  const sorted = [...entries].sort((left, right) => {
    const byTime = timestamp(left.createdAt, left.id) - timestamp(right.createdAt, right.id);
    if (byTime !== 0) return byTime;
    const byKind = (KIND_ORDER.get(left.kind) ?? 0) - (KIND_ORDER.get(right.kind) ?? 0);
    return byKind !== 0 ? byKind : compareText(left.id, right.id);
  });
  return Object.freeze(sorted);
}

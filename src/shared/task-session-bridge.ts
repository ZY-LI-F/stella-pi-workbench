import type { BoardState, OpenTaskSessionInput } from "./kanban";

export interface TaskSessionTarget {
  readonly taskId: string;
  readonly projectPath: string;
  readonly trusted: boolean;
  readonly sessionPath: string;
}

export function resolveTaskSessionTarget(
  state: BoardState,
  input: OpenTaskSessionInput,
  canonicalizePath: (path: string) => string,
): TaskSessionTarget {
  const task = state.tasks.find((candidate) => candidate.id === input.taskId);
  if (!task) throw new Error(`找不到任务: ${input.taskId}`);
  const sessionPaths = [
    task.sourcePiSessionPath,
    ...state.runs.filter((run) => run.taskId === task.id).flatMap((run) => run.steps.flatMap((step) => [step.sessionPath, step.artifact?.sessionPath])),
    ...state.agentTasks.filter((agentTask) => agentTask.taskId === task.id).map((agentTask) => agentTask.sessionPath),
  ].filter((path): path is string => typeof path === "string");
  const requested = canonicalizePath(input.sessionPath);
  const persisted = sessionPaths.find((path) => canonicalizePath(path) === requested);
  if (!persisted) throw new Error("所选 Pi session 不属于该任务的来源或执行记录");
  return Object.freeze({
    taskId: task.id,
    projectPath: task.projectPath,
    trusted: task.trusted,
    sessionPath: persisted,
  });
}

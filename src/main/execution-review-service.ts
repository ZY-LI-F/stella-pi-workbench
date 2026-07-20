import { randomUUID } from "node:crypto";
import type { BoardRepository } from "./board-repository";
import type {
  AgentTask,
  BoardBootstrap,
  BoardState,
  ExecutionAcceptanceStatus,
  OrchestrationCatalog,
  ReviewExecutionInput,
  TaskActivity,
  TaskComment,
  WorkflowRun,
} from "../shared/kanban";
import { catalogForBoard } from "../shared/orchestration-catalog";
import { applyTaskLifecycle } from "../shared/task-lifecycle";

interface ExecutionReviewServiceDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly now?: () => string;
  readonly id?: () => string;
}

function decisionStatus(decision: ReviewExecutionInput["decision"]): ExecutionAcceptanceStatus {
  if (decision === "accept") return "accepted";
  return decision === "revision-requested" ? "revision-requested" : "rejected";
}

function decisionLabel(decision: ReviewExecutionInput["decision"]): string {
  if (decision === "accept") return "已接受";
  return decision === "revision-requested" ? "已请求修订" : "已拒绝";
}

export class ExecutionReviewService {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly #now: () => string;
  readonly #id: () => string;

  constructor(dependencies: ExecutionReviewServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#emitChanged = dependencies.emitChanged;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
  }

  async review(input: ReviewExecutionInput): Promise<BoardBootstrap> {
    const comment = input.comment.trim();
    if ((input.decision === "revision-requested" || input.decision === "reject") && !comment) {
      throw new Error("请求修订或拒绝执行结果时必须填写理由");
    }
    const now = this.#now();
    const acceptance = decisionStatus(input.decision);
    const board = await this.#repository.update((current) => {
      const currentTask = current.tasks.find((candidate) => candidate.id === input.taskId);
      if (!currentTask) throw new Error(`找不到任务: ${input.taskId}`);
      const activeExecutionId = currentTask.activeRunId ?? currentTask.activeAgentTaskId;
      if (activeExecutionId && activeExecutionId !== input.executionId) {
        throw new Error("任务有正在进行的执行，请先中止或等待完成再验收");
      }
      const result = input.executionKind === "workflow"
        ? this.#reviewWorkflow(current, input, acceptance, comment, now)
        : this.#reviewAgentTask(current, input, acceptance, comment, now);
      const task = result.tasks.find((candidate) => candidate.id === input.taskId);
      if (!task) throw new Error(`找不到任务: ${input.taskId}`);
      const reviewedTask = input.decision === "accept"
        ? applyTaskLifecycle(task, { type: "execution-accepted" }, now)
        : input.decision === "revision-requested"
          ? applyTaskLifecycle(task, { type: "revision-requested" }, now)
          : applyTaskLifecycle(task, { type: "execution-rejected", reason: comment }, now);
      const label = decisionLabel(input.decision);
      const provenance = input.executionKind === "workflow"
        ? { runId: input.executionId }
        : { agentTaskId: input.executionId };
      const message: TaskComment = Object.freeze({
        id: this.#id(),
        taskId: input.taskId,
        author: "user",
        messageKind: "acceptance",
        ...provenance,
        body: comment ? `${label}：${comment}` : label,
        createdAt: now,
      });
      const activity: TaskActivity = Object.freeze({
        id: this.#id(),
        taskId: input.taskId,
        kind: "gate",
        ...provenance,
        summary: `执行结果${label}`,
        detail: comment || undefined,
        createdAt: now,
      });
      return Object.freeze({
        ...result,
        tasks: Object.freeze(result.tasks.map((candidate) => candidate.id === task.id ? reviewedTask : candidate)),
        comments: Object.freeze([...result.comments, message]),
        activities: Object.freeze([...result.activities, activity]),
      });
    });
    const bootstrap = Object.freeze({ board, catalog: catalogForBoard(this.#catalog, board) });
    this.#emitChanged(bootstrap);
    return bootstrap;
  }

  #reviewWorkflow(
    state: BoardState,
    input: ReviewExecutionInput,
    acceptance: ExecutionAcceptanceStatus,
    comment: string,
    now: string,
  ): BoardState {
    const run = state.runs.find((candidate) => candidate.id === input.executionId && candidate.taskId === input.taskId);
    if (!run) throw new Error(`找不到 Workflow execution: ${input.executionId}`);
    this.#assertPending(run, `Workflow execution ${run.id}`);
    const reviewed: WorkflowRun = Object.freeze({ ...run, acceptance, acceptanceComment: comment || undefined, reviewedAt: now, updatedAt: now });
    return Object.freeze({ ...state, runs: Object.freeze(state.runs.map((candidate) => candidate.id === run.id ? reviewed : candidate)) });
  }

  #reviewAgentTask(
    state: BoardState,
    input: ReviewExecutionInput,
    acceptance: ExecutionAcceptanceStatus,
    comment: string,
    now: string,
  ): BoardState {
    const agentTask = state.agentTasks.find((candidate) => candidate.id === input.executionId && candidate.taskId === input.taskId);
    if (!agentTask) throw new Error(`找不到 AgentTask execution: ${input.executionId}`);
    if (agentTask.parentAgentTaskId) throw new Error("只能验收根 AgentTask");
    this.#assertPending(agentTask, `AgentTask execution ${agentTask.id}`);
    const reviewed: AgentTask = Object.freeze({ ...agentTask, acceptance, acceptanceComment: comment || undefined, reviewedAt: now, updatedAt: now });
    return Object.freeze({ ...state, agentTasks: Object.freeze(state.agentTasks.map((candidate) => candidate.id === agentTask.id ? reviewed : candidate)) });
  }

  #assertPending(execution: Pick<WorkflowRun | AgentTask, "status" | "acceptance">, label: string): void {
    if (execution.status !== "reported") throw new Error(`${label} 尚未 reported，不能验收`);
    if (execution.acceptance !== "pending") throw new Error(`${label} 的验收结论已记录为 ${execution.acceptance}`);
  }
}

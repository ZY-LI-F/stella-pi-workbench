import { randomUUID } from "node:crypto";
import type { BoardRepository } from "./board-repository";
import {
  TASK_PRIORITIES,
  canMoveTaskManually,
  type BoardBootstrap,
  type BoardState,
  type CreateTaskInput,
  type ExecutionTarget,
  type KanbanTask,
  type ManualTaskStage,
  type OrchestrationCatalog,
  type TaskActivity,
  type UpdateTaskInput,
} from "../shared/kanban";

interface BoardServiceDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly now?: () => string;
  readonly id?: () => string;
}

function normalizedText(value: string, label: string, required: boolean): string {
  const normalized = value.trim();
  if (required && normalized.length === 0) throw new Error(`${label}不能为空`);
  return normalized;
}

export class BoardService {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly #now: () => string;
  readonly #id: () => string;

  constructor(dependencies: BoardServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#emitChanged = dependencies.emitChanged;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
  }

  async bootstrap(): Promise<BoardBootstrap> {
    return Object.freeze({ board: await this.#repository.read(), catalog: this.#catalog });
  }

  async createTask(input: CreateTaskInput): Promise<BoardBootstrap> {
    if (!TASK_PRIORITIES.includes(input.priority)) throw new Error(`无效优先级: ${String(input.priority)}`);
    const now = this.#now();
    return this.#commit((current) => {
      this.#assertExecutionTarget(current, input.executionTarget);
      const task: KanbanTask = Object.freeze({
        id: this.#id(),
        title: normalizedText(input.title, "任务标题", true),
        description: normalizedText(input.description, "任务说明", false),
        acceptanceCriteria: normalizedText(input.acceptanceCriteria, "验收标准", false),
        priority: input.priority,
        projectPath: normalizedText(input.projectPath, "项目路径", true),
        projectName: normalizedText(input.projectName, "项目名称", true),
        trusted: input.trusted,
        executionTarget: Object.freeze({ ...input.executionTarget }),
        stage: "planned",
        sourcePiSessionPath: input.sourcePiSessionPath,
        sourcePiSessionId: input.sourcePiSessionId,
        createdAt: now,
        updatedAt: now,
      });
      return {
        ...current,
        tasks: [task, ...current.tasks],
        activities: [...current.activities, this.#activity(task.id, "task", "任务已创建", undefined, now)],
      };
    });
  }

  async updateTask(input: UpdateTaskInput): Promise<BoardBootstrap> {
    if (!TASK_PRIORITIES.includes(input.priority)) throw new Error(`无效优先级: ${String(input.priority)}`);
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#task(current, input.taskId);
      if (task.activeRunId || task.activeAgentTaskId) throw new Error("运行中的任务不能编辑；请先中止执行");
      this.#assertExecutionTarget(current, input.executionTarget);
      const nextTask: KanbanTask = Object.freeze({
        ...task,
        title: normalizedText(input.title, "任务标题", true),
        description: normalizedText(input.description, "任务说明", false),
        acceptanceCriteria: normalizedText(input.acceptanceCriteria, "验收标准", false),
        priority: input.priority,
        executionTarget: Object.freeze({ ...input.executionTarget }),
        updatedAt: now,
      });
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
        activities: [...current.activities, this.#activity(task.id, "task", "任务内容已更新", undefined, now)],
      };
    });
  }

  async moveTask(taskId: string, stage: ManualTaskStage): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#task(current, taskId);
      if (!canMoveTaskManually(task, stage)) {
        throw new Error("只能把未运行的任务手动移到待规划、受阻或已完成列");
      }
      const nextTask: KanbanTask = Object.freeze({
        ...task,
        stage,
        blockedReason: stage === "blocked" ? "由用户手动标记为受阻" : undefined,
        updatedAt: now,
      });
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
        activities: [...current.activities, this.#activity(task.id, "status", `任务已移到${stage === "planned" ? "待规划" : stage === "blocked" ? "受阻" : "已完成"}`, undefined, now)],
      };
    });
  }

  async deleteTask(taskId: string): Promise<BoardBootstrap> {
    return this.#commit((current) => {
      const task = this.#task(current, taskId);
      if (task.activeRunId || task.activeAgentTaskId) throw new Error("运行中的任务不能删除；请先中止执行");
      return {
        ...current,
        tasks: current.tasks.filter((candidate) => candidate.id !== task.id),
        runs: current.runs.filter((run) => run.taskId !== task.id),
        activities: current.activities.filter((activity) => activity.taskId !== task.id),
        comments: current.comments.filter((comment) => comment.taskId !== task.id),
        agentTasks: current.agentTasks.filter((agentTask) => agentTask.taskId !== task.id),
      };
    });
  }

  #task(state: BoardState, taskId: string): KanbanTask {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`找不到任务: ${taskId}`);
    return task;
  }

  #assertExecutionTarget(state: BoardState, target: ExecutionTarget): void {
    if (target.kind === "workflow" && !this.#catalog.workflows.some((workflow) => workflow.id === target.workflowId)) {
      throw new Error(`未知流程模板: ${target.workflowId}`);
    }
    if (target.kind === "agent" && !this.#catalog.agents.some((agent) => agent.id === target.agentId)) {
      throw new Error(`未知 Agent: ${target.agentId}`);
    }
    if (target.kind === "squad" && !state.squads.some((squad) => squad.id === target.squadId)) {
      throw new Error(`未知 Squad: ${target.squadId}`);
    }
  }

  #activity(taskId: string, kind: TaskActivity["kind"], summary: string, detail: string | undefined, now: string): TaskActivity {
    return Object.freeze({ id: this.#id(), taskId, kind, summary, detail, createdAt: now });
  }

  async #commit(transform: (current: BoardState) => BoardState): Promise<BoardBootstrap> {
    const board = await this.#repository.update(transform);
    const bootstrap = Object.freeze({ board, catalog: this.#catalog });
    this.#emitChanged(bootstrap);
    return bootstrap;
  }
}

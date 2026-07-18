import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  EMPTY_BOARD_STATE,
  BOARD_SCHEMA_V3,
  BOARD_SCHEMA_V2,
  LEGACY_BOARD_SCHEMA_VERSION,
  parseBoardFile,
  parseBoardState,
  type BoardState,
  type TaskActivity,
} from "../shared/kanban";
import { applyTaskLifecycle } from "../shared/task-lifecycle";
import type { BoardRepository } from "./board-repository";

interface BoardStoreDependencies {
  readonly now: () => string;
  readonly id: () => string;
}

const DEFAULT_DEPENDENCIES: BoardStoreDependencies = Object.freeze({
  now: () => new Date().toISOString(),
  id: randomUUID,
});

export class BoardStore implements BoardRepository {
  readonly #path: string;
  readonly #dependencies: BoardStoreDependencies;
  #state: BoardState | null = null;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string, dependencies: BoardStoreDependencies = DEFAULT_DEPENDENCIES) {
    this.#path = path;
    this.#dependencies = dependencies;
  }

  async initialize(): Promise<BoardState> {
    const loaded = await this.#load();
    this.#state = loaded;
    const interruptedRuns = loaded.runs.filter((run) => run.status === "queued" || run.status === "running");
    const interruptedAgentTasks = loaded.agentTasks.filter((agentTask) => agentTask.status === "running");
    if (interruptedRuns.length === 0 && interruptedAgentTasks.length === 0) return loaded;

    const interruptedIds = new Set(interruptedRuns.map((run) => run.id));
    const interruptedAgentTaskIds = new Set(interruptedAgentTasks.map((agentTask) => agentTask.id));
    const now = this.#dependencies.now();
    return this.update((current) => {
      const workflowActivities: TaskActivity[] = interruptedRuns.map((run) => Object.freeze({
        id: this.#dependencies.id(),
        taskId: run.taskId,
        runId: run.id,
        stepId: run.currentStepId,
        kind: "error",
        summary: "应用重启，运行已中断",
        detail: "Stella 不会把未完成的进程标记为成功；可从任务详情重新分发。",
        createdAt: now,
      }));
      const agentTaskActivities: TaskActivity[] = interruptedAgentTasks.map((agentTask) => Object.freeze({
        id: this.#dependencies.id(),
        taskId: agentTask.taskId,
        agentTaskId: agentTask.id,
        kind: "error",
        summary: "应用重启，Agent 执行已中断",
        detail: `${agentTask.agentSnapshot.name} 的进程已不存在；已排队工作仍会继续执行。`,
        createdAt: now,
      }));
      return {
        ...current,
        tasks: current.tasks.map((task) => {
          if (interruptedIds.has(task.activeRunId ?? "")) {
            return applyTaskLifecycle(Object.freeze({
              ...task,
              activeRunId: undefined,
            }), { type: "execution-interrupted", reason: "应用重启，流程已中断" }, now);
          }
          if (interruptedAgentTaskIds.has(task.activeAgentTaskId ?? "")) {
            return applyTaskLifecycle(Object.freeze({
              ...task,
              activeAgentTaskId: undefined,
            }), { type: "execution-interrupted", reason: "应用重启，Agent 执行已中断" }, now);
          }
          return task;
        }),
        runs: current.runs.map((run) => interruptedIds.has(run.id)
          ? Object.freeze({
              ...run,
              status: "interrupted" as const,
              currentStepId: undefined,
              steps: Object.freeze(run.steps.map((step) => step.status === "running"
                ? Object.freeze({ ...step, status: "interrupted" as const, completedAt: now, error: "应用重启" })
                : step)),
              updatedAt: now,
              completedAt: now,
            })
          : run),
        agentTasks: current.agentTasks.map((agentTask) => interruptedAgentTaskIds.has(agentTask.id)
          ? Object.freeze({
              ...agentTask,
              status: "interrupted" as const,
              runtimeToken: undefined,
              error: "Stella 在 Agent 执行期间退出。",
              updatedAt: now,
              completedAt: now,
            })
          : agentTask),
        activities: [...current.activities, ...workflowActivities, ...agentTaskActivities],
      };
    });
  }

  async read(): Promise<BoardState> {
    if (this.#state) return this.#state;
    this.#state = await this.#load();
    return this.#state;
  }

  update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    const operation = this.#writeQueue.then(async () => {
      const current = await this.read();
      const next = parseBoardState(transform(current));
      await this.#write(next);
      this.#state = next;
      return next;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #load(): Promise<BoardState> {
    try {
      const contents = await readFile(this.#path, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`无法解析看板文件 ${this.#path}: ${message}`);
      }
      const sourceVersion = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).version
        : undefined;
      if (sourceVersion === LEGACY_BOARD_SCHEMA_VERSION || sourceVersion === BOARD_SCHEMA_V2 || sourceVersion === BOARD_SCHEMA_V3) {
        const timestamp = this.#dependencies.now().replaceAll(":", "-");
        const backupPath = `${this.#path}.v${sourceVersion}.${timestamp}.${this.#dependencies.id()}.bak`;
        await copyFile(this.#path, backupPath);
        try {
          const migrated = parseBoardFile(parsed).state;
          await this.#write(migrated);
          return migrated;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`迁移 schema v${sourceVersion} 看板失败；原文件未修改，备份位于 ${backupPath}: ${message}`);
        }
      }
      return parseBoardFile(parsed).state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_BOARD_STATE;
      throw error;
    }
  }

  async #write(state: BoardState): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tempPath = `${this.#path}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.#path);
  }
}

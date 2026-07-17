import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  BOARD_SCHEMA_VERSION,
  EMPTY_BOARD_STATE,
  parseBoardState,
  type BoardState,
  type TaskActivity,
} from "../shared/kanban";
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
    if (interruptedRuns.length === 0) return loaded;

    const interruptedIds = new Set(interruptedRuns.map((run) => run.id));
    const now = this.#dependencies.now();
    return this.update((current) => {
      const activities: TaskActivity[] = interruptedRuns.map((run) => Object.freeze({
        id: this.#dependencies.id(),
        taskId: run.taskId,
        runId: run.id,
        stepId: run.currentStepId,
        kind: "error",
        summary: "应用重启，运行已中断",
        detail: "Stella 不会把未完成的进程标记为成功；可从任务详情重新分发。",
        createdAt: now,
      }));
      return {
        version: BOARD_SCHEMA_VERSION,
        tasks: current.tasks.map((task) => interruptedIds.has(task.activeRunId ?? "")
          ? Object.freeze({
              ...task,
              status: "interrupted" as const,
              activeRunId: undefined,
              blockedReason: "Stella 在流程运行期间退出。",
              updatedAt: now,
            })
          : task),
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
        activities: [...current.activities, ...activities],
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
      return parseBoardState(parsed);
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

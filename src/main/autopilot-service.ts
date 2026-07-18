import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { BoardRepository } from "./board-repository";
import {
  TASK_PRIORITIES,
  type Autopilot,
  type AutopilotRun,
  type AutopilotTrigger,
  type BoardBootstrap,
  type BoardState,
  type CreateAutopilotInput,
  type ExecutionTarget,
  type JsonObject,
  type KanbanTask,
  type OrchestrationCatalog,
  type TaskActivity,
  type UpdateAutopilotInput,
} from "../shared/kanban";

interface AutopilotServiceDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly dispatchTask: (taskId: string) => Promise<BoardBootstrap>;
  readonly emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly now?: () => string;
  readonly id?: () => string;
  readonly token?: () => string;
}

export interface TriggerAutopilotInput {
  readonly autopilotId: string;
  readonly triggerKind: AutopilotTrigger["kind"];
  readonly requestPayload?: JsonObject;
  readonly expectedScheduleAt?: string;
}

export interface AutopilotTriggerResult {
  readonly bootstrap: BoardBootstrap;
  readonly autopilotId: string;
  readonly runId: string;
  readonly taskId: string;
}

export class WebhookAutopilotNotFoundError extends Error {
  constructor() {
    super("Webhook token 无效或规则不存在");
    this.name = "WebhookAutopilotNotFoundError";
  }
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

function nextFutureOccurrence(scheduledAt: string, intervalMinutes: number, baseline: string): string {
  const scheduled = Date.parse(scheduledAt);
  const baselineTime = Date.parse(baseline);
  if (Number.isNaN(scheduled) || Number.isNaN(baselineTime)) throw new Error("Schedule 时间不是有效日期");
  const interval = intervalMinutes * 60_000;
  const elapsedIntervals = Math.floor(Math.max(0, baselineTime - scheduled) / interval) + 1;
  return new Date(scheduled + elapsedIntervals * interval).toISOString();
}

function tokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export class AutopilotService {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #dispatchTask: (taskId: string) => Promise<BoardBootstrap>;
  readonly #emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly #now: () => string;
  readonly #id: () => string;
  readonly #token: () => string;

  constructor(dependencies: AutopilotServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#dispatchTask = dependencies.dispatchTask;
    this.#emitChanged = dependencies.emitChanged;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
    this.#token = dependencies.token ?? (() => randomBytes(24).toString("base64url"));
  }

  async create(input: CreateAutopilotInput): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const normalized = this.#validatedInput(current, input);
      if (current.autopilots.some((autopilot) => autopilot.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase())) {
        throw new Error(`Autopilot 名称已存在: ${normalized.name}`);
      }
      const trigger: AutopilotTrigger = normalized.trigger.kind === "webhook"
        ? Object.freeze({ kind: "webhook", token: this.#token() })
        : normalized.trigger;
      const autopilot: Autopilot = Object.freeze({ id: this.#id(), ...normalized, trigger, createdAt: now, updatedAt: now });
      return { ...current, autopilots: [...current.autopilots, autopilot] };
    });
  }

  async update(input: UpdateAutopilotInput): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const existing = this.#autopilot(current, input.autopilotId);
      const normalized = this.#validatedInput(current, input);
      if (current.autopilots.some((autopilot) => autopilot.id !== existing.id && autopilot.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase())) {
        throw new Error(`Autopilot 名称已存在: ${normalized.name}`);
      }
      const autopilot: Autopilot = Object.freeze({ ...existing, ...normalized, trigger: Object.freeze({ ...input.trigger }), updatedAt: now });
      return { ...current, autopilots: current.autopilots.map((candidate) => candidate.id === autopilot.id ? autopilot : candidate) };
    });
  }

  async delete(autopilotId: string): Promise<BoardBootstrap> {
    return this.#commit((current) => {
      this.#autopilot(current, autopilotId);
      return { ...current, autopilots: current.autopilots.filter((candidate) => candidate.id !== autopilotId) };
    });
  }

  async reconcileMissedSchedules(asOf = this.#now()): Promise<BoardBootstrap | undefined> {
    if (Number.isNaN(Date.parse(asOf))) throw new Error("Schedule 恢复基准不是有效日期");
    let changed = false;
    const board = await this.#repository.update((current) => {
      const missedRuns: AutopilotRun[] = [];
      const autopilots = current.autopilots.map((autopilot) => {
        if (!autopilot.enabled || autopilot.trigger.kind !== "schedule" || Date.parse(autopilot.trigger.nextRunAt) > Date.parse(asOf)) {
          return autopilot;
        }
        changed = true;
        const scheduledAt = autopilot.trigger.nextRunAt;
        missedRuns.push(Object.freeze({
          id: this.#id(),
          autopilotId: autopilot.id,
          triggerKind: "schedule",
          status: "missed",
          error: "Stella 未运行，已跳过停机期间到期的计划",
          startedAt: scheduledAt,
          completedAt: asOf,
        }));
        return Object.freeze({
          ...autopilot,
          trigger: Object.freeze({
            ...autopilot.trigger,
            nextRunAt: nextFutureOccurrence(scheduledAt, autopilot.trigger.intervalMinutes, asOf),
          }),
          updatedAt: asOf,
        });
      });
      return changed ? { ...current, autopilots, autopilotRuns: [...missedRuns, ...current.autopilotRuns] } : current;
    });
    if (!changed) return undefined;
    const bootstrap = Object.freeze({ board, catalog: this.#catalog });
    this.#emitChanged(bootstrap);
    return bootstrap;
  }

  async trigger(input: TriggerAutopilotInput): Promise<BoardBootstrap> {
    return (await this.triggerDetailed(input)).bootstrap;
  }

  async triggerWebhook(token: string, requestPayload: JsonObject): Promise<AutopilotTriggerResult> {
    const normalizedToken = required(token, "Webhook token");
    const state = await this.#repository.read();
    const autopilot = state.autopilots.find((candidate) =>
      candidate.trigger.kind === "webhook" && tokensEqual(candidate.trigger.token, normalizedToken));
    if (!autopilot) throw new WebhookAutopilotNotFoundError();
    return this.triggerDetailed({ autopilotId: autopilot.id, triggerKind: "webhook", requestPayload });
  }

  async triggerDetailed(input: TriggerAutopilotInput): Promise<AutopilotTriggerResult> {
    const now = this.#now();
    const taskId = this.#id();
    const runId = this.#id();
    await this.#commit((current) => {
      const autopilot = this.#autopilot(current, input.autopilotId);
      if (!autopilot.enabled) throw new Error(`Autopilot「${autopilot.name}」已禁用`);
      if (autopilot.trigger.kind !== input.triggerKind) {
        throw new Error(`Autopilot 触发类型不匹配：期望 ${autopilot.trigger.kind}，收到 ${input.triggerKind}`);
      }
      let autopilots = current.autopilots;
      if (autopilot.trigger.kind === "schedule") {
        if (!input.expectedScheduleAt) throw new Error("Schedule 触发缺少 expectedScheduleAt");
        if (autopilot.trigger.nextRunAt !== input.expectedScheduleAt) {
          throw new Error(`Schedule 已变更：期望 ${input.expectedScheduleAt}，当前 ${autopilot.trigger.nextRunAt}`);
        }
        const advanced: Autopilot = Object.freeze({
          ...autopilot,
          trigger: Object.freeze({
            ...autopilot.trigger,
            nextRunAt: nextFutureOccurrence(autopilot.trigger.nextRunAt, autopilot.trigger.intervalMinutes, now),
          }),
          updatedAt: now,
        });
        autopilots = current.autopilots.map((candidate) => candidate.id === advanced.id ? advanced : candidate);
      } else if (input.expectedScheduleAt) {
        throw new Error(`${autopilot.trigger.kind} 触发不能携带 expectedScheduleAt`);
      }
      this.#assertExecutionTarget(current, autopilot.executionTarget);
      const payloadText = input.requestPayload ? `\n\nWebhook payload:\n${JSON.stringify(input.requestPayload, null, 2)}` : "";
      const task: KanbanTask = Object.freeze({
        id: taskId,
        title: autopilot.taskTemplate.title,
        description: `${autopilot.taskTemplate.description}${payloadText}`.trim(),
        acceptanceCriteria: autopilot.taskTemplate.acceptanceCriteria,
        priority: autopilot.taskTemplate.priority,
        projectPath: autopilot.projectPath,
        projectName: autopilot.projectName,
        trusted: autopilot.trusted,
        executionTarget: Object.freeze({ ...autopilot.executionTarget }),
        status: "planned",
        createdAt: now,
        updatedAt: now,
      });
      const run: AutopilotRun = Object.freeze({
        id: runId,
        autopilotId: autopilot.id,
        triggerKind: input.triggerKind,
        status: "running",
        taskId: task.id,
        requestPayload: input.requestPayload,
        startedAt: now,
      });
      return {
        ...current,
        autopilots,
        tasks: [task, ...current.tasks],
        autopilotRuns: [run, ...current.autopilotRuns],
        activities: [...current.activities, this.#activity(task.id, "automation", `Autopilot「${autopilot.name}」已触发`, input.triggerKind, now)],
      };
    });

    try {
      await this.#dispatchTask(taskId);
      const completedAt = this.#now();
      const bootstrap = await this.#commit((current) => ({
        ...current,
        autopilotRuns: current.autopilotRuns.map((run) => run.id === runId
          ? Object.freeze({ ...run, status: "succeeded" as const, completedAt })
          : run),
      }));
      return Object.freeze({ bootstrap, autopilotId: input.autopilotId, runId, taskId });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const completedAt = this.#now();
      await this.#commit((current) => ({
        ...current,
        autopilotRuns: current.autopilotRuns.map((run) => run.id === runId
          ? Object.freeze({ ...run, status: "failed" as const, error: message, completedAt })
          : run),
        activities: [...current.activities, this.#activity(taskId, "error", "Autopilot 分发失败", message, completedAt)],
      }));
      throw new Error(`Autopilot 触发失败: ${message}`);
    }
  }

  #validatedInput(
    state: BoardState,
    input: CreateAutopilotInput | UpdateAutopilotInput,
  ): Omit<Autopilot, "id" | "createdAt" | "updatedAt" | "trigger"> & { readonly trigger: CreateAutopilotInput["trigger"] | AutopilotTrigger } {
    if (!TASK_PRIORITIES.includes(input.taskTemplate.priority)) throw new Error(`无效优先级: ${String(input.taskTemplate.priority)}`);
    this.#assertExecutionTarget(state, input.executionTarget);
    if (input.trigger.kind === "schedule") {
      if (!Number.isInteger(input.trigger.intervalMinutes) || input.trigger.intervalMinutes <= 0) throw new Error("计划间隔必须是正整数分钟");
      if (Number.isNaN(Date.parse(input.trigger.nextRunAt))) throw new Error("nextRunAt 不是有效日期");
    }
    if (input.trigger.kind === "webhook" && "token" in input.trigger) required(input.trigger.token, "Webhook token");
    return Object.freeze({
      name: required(input.name, "Autopilot 名称"),
      enabled: input.enabled,
      trigger: Object.freeze({ ...input.trigger }),
      taskTemplate: Object.freeze({
        title: required(input.taskTemplate.title, "任务标题"),
        description: input.taskTemplate.description.trim(),
        acceptanceCriteria: input.taskTemplate.acceptanceCriteria.trim(),
        priority: input.taskTemplate.priority,
      }),
      projectPath: required(input.projectPath, "项目路径"),
      projectName: required(input.projectName, "项目名称"),
      trusted: input.trusted,
      executionTarget: Object.freeze({ ...input.executionTarget }),
    });
  }

  #assertExecutionTarget(state: BoardState, target: ExecutionTarget): void {
    if (target.kind === "workflow" && !this.#catalog.workflows.some((workflow) => workflow.id === target.workflowId)) throw new Error(`未知流程模板: ${target.workflowId}`);
    if (target.kind === "agent" && !this.#catalog.agents.some((agent) => agent.id === target.agentId)) throw new Error(`未知 Agent: ${target.agentId}`);
    if (target.kind === "squad" && !state.squads.some((squad) => squad.id === target.squadId)) throw new Error(`未知 Squad: ${target.squadId}`);
  }

  #autopilot(state: BoardState, autopilotId: string): Autopilot {
    const autopilot = state.autopilots.find((candidate) => candidate.id === autopilotId);
    if (!autopilot) throw new Error(`找不到 Autopilot: ${autopilotId}`);
    return autopilot;
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

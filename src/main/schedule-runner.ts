import type { BoardRepository } from "./board-repository";
import type { AutopilotService } from "./autopilot-service";
import type { BoardBridgeEvent } from "../shared/kanban";

const MAX_NODE_TIMEOUT_MS = 2_147_483_647;

export type ScheduleTimerHandle = ReturnType<typeof setTimeout>;

export interface ScheduleTimer {
  set(callback: () => void, delayMs: number): ScheduleTimerHandle;
  clear(handle: ScheduleTimerHandle): void;
}

interface ScheduleRunnerDependencies {
  readonly repository: BoardRepository;
  readonly autopilotService: AutopilotService;
  readonly emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly now?: () => string;
  readonly timer?: ScheduleTimer;
}

const SYSTEM_TIMER: ScheduleTimer = Object.freeze({
  set: (callback: () => void, delayMs: number) => setTimeout(callback, delayMs),
  clear: (handle: ScheduleTimerHandle) => clearTimeout(handle),
});

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export class ScheduleRunner {
  readonly #repository: BoardRepository;
  readonly #autopilotService: AutopilotService;
  readonly #emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly #now: () => string;
  readonly #timerApi: ScheduleTimer;
  #started = false;
  #epoch = 0;
  #timer?: ScheduleTimerHandle;

  constructor(dependencies: ScheduleRunnerDependencies) {
    this.#repository = dependencies.repository;
    this.#autopilotService = dependencies.autopilotService;
    this.#emitBoardEvent = dependencies.emitBoardEvent;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#timerApi = dependencies.timer ?? SYSTEM_TIMER;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      await this.#autopilotService.reconcileMissedSchedules(this.#now());
      await this.#reschedule();
    } catch (cause) {
      this.#started = false;
      this.#clearTimer();
      throw cause;
    }
  }

  async notify(): Promise<void> {
    if (!this.#started) return;
    await this.#reschedule();
  }

  async stop(): Promise<void> {
    this.#started = false;
    this.#epoch += 1;
    this.#clearTimer();
  }

  async #reschedule(): Promise<void> {
    const epoch = ++this.#epoch;
    this.#clearTimer();
    const state = await this.#repository.read();
    if (!this.#started || epoch !== this.#epoch) return;

    const nextRunAt = state.autopilots
      .filter((autopilot) => autopilot.enabled && autopilot.trigger.kind === "schedule")
      .map((autopilot) => autopilot.trigger.kind === "schedule" ? Date.parse(autopilot.trigger.nextRunAt) : Number.POSITIVE_INFINITY)
      .sort((left, right) => left - right)[0];
    if (nextRunAt === undefined) return;

    const now = Date.parse(this.#now());
    if (Number.isNaN(now)) throw new Error("ScheduleRunner 时钟返回了无效日期");
    const delay = Math.min(MAX_NODE_TIMEOUT_MS, Math.max(0, nextRunAt - now));
    this.#timer = this.#timerApi.set(() => {
      void this.#handleTimer(epoch).catch((cause: unknown) => {
        this.#emitBoardEvent({ type: "automation-error", source: "schedule", message: errorMessage(cause) });
      });
    }, delay);
  }

  async #handleTimer(epoch: number): Promise<void> {
    if (!this.#started || epoch !== this.#epoch) return;
    this.#timer = undefined;
    const now = this.#now();
    const nowTime = Date.parse(now);
    if (Number.isNaN(nowTime)) throw new Error("ScheduleRunner 时钟返回了无效日期");
    const state = await this.#repository.read();
    if (!this.#started || epoch !== this.#epoch) return;

    const due = state.autopilots
      .filter((autopilot) => autopilot.enabled && autopilot.trigger.kind === "schedule" && Date.parse(autopilot.trigger.nextRunAt) <= nowTime)
      .sort((left, right) => {
        if (left.trigger.kind !== "schedule" || right.trigger.kind !== "schedule") return 0;
        return Date.parse(left.trigger.nextRunAt) - Date.parse(right.trigger.nextRunAt) || left.id.localeCompare(right.id);
      });

    for (const autopilot of due) {
      if (!this.#started || epoch !== this.#epoch) return;
      if (autopilot.trigger.kind !== "schedule") continue;
      try {
        await this.#autopilotService.trigger({
          autopilotId: autopilot.id,
          triggerKind: "schedule",
          expectedScheduleAt: autopilot.trigger.nextRunAt,
        });
      } catch (cause) {
        this.#emitBoardEvent({
          type: "automation-error",
          source: "schedule",
          message: `Autopilot「${autopilot.name}」计划触发失败：${errorMessage(cause)}`,
        });
      }
    }

    if (this.#started && epoch === this.#epoch) await this.#reschedule();
  }

  #clearTimer(): void {
    if (this.#timer === undefined) return;
    this.#timerApi.clear(this.#timer);
    this.#timer = undefined;
  }
}

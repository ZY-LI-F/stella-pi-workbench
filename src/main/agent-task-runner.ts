import type { PiCommand, PiResponse, RuntimeSignal } from "../shared/contracts";
import type { BoardBootstrap, BoardBridgeEvent } from "../shared/kanban";
import type { PiRuntimeStartOptions } from "./pi-rpc-runtime";
import { AgentTaskService, type ClaimedAgentTask } from "./agent-task-service";

export interface AgentTaskRuntime {
  readonly running: boolean;
  start(options: PiRuntimeStartOptions): Promise<void>;
  send(command: PiCommand): Promise<PiResponse>;
  abortAndStop(): Promise<void>;
  stop(): Promise<void>;
}

export interface AgentTaskRuntimeFactory {
  create(callbacks: {
    readonly emitPiEvent: (event: unknown) => void;
    readonly emitRuntimeSignal: (signal: RuntimeSignal) => void;
  }): AgentTaskRuntime;
}

interface AgentTaskRunnerDependencies {
  readonly service: AgentTaskService;
  readonly runtimeFactory: AgentTaskRuntimeFactory;
  readonly emitBoardEvent: (event: BoardBridgeEvent) => void;
}

interface ActiveExecution {
  readonly taskId: string;
  readonly agentTaskId: string;
  readonly runtimeToken: string;
  readonly runtime: AgentTaskRuntime;
  settling: boolean;
}

interface RpcStateData {
  readonly sessionFile?: string;
}

interface RpcStatsData {
  readonly tokens?: { readonly input?: number; readonly output?: number };
  readonly cost?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const field = record(value)?.[key];
  return typeof field === "string" ? field : undefined;
}

function responseData<T>(response: PiResponse, command: string): T {
  if (!response.success) throw new Error(response.error);
  if (!("data" in response)) throw new Error(`Pi RPC 命令 ${command} 没有返回 data`);
  return response.data as T;
}

export class AgentTaskRunner {
  readonly #service: AgentTaskService;
  readonly #runtimeFactory: AgentTaskRuntimeFactory;
  readonly #emitBoardEvent: (event: BoardBridgeEvent) => void;
  #active?: ActiveExecution;
  #draining = false;
  #stopping = false;

  constructor(dependencies: AgentTaskRunnerDependencies) {
    this.#service = dependencies.service;
    this.#runtimeFactory = dependencies.runtimeFactory;
    this.#emitBoardEvent = dependencies.emitBoardEvent;
  }

  start(): void {
    this.#stopping = false;
    void this.#service.reconcileWaitingParents()
      .then(() => this.notify())
      .catch((error) => this.#reportError(error));
  }

  notify(): void {
    if (this.#stopping || this.#active || this.#draining) return;
    void this.#drain().catch((error) => this.#reportError(error));
  }

  async abortTask(taskId: string): Promise<BoardBootstrap> {
    const result = await this.#service.abortTask(taskId);
    const active = this.#active;
    if (active && active.agentTaskId === (result.runningAgentTaskId ?? result.agentTaskId)) {
      this.#active = undefined;
      await active.runtime.abortAndStop();
    }
    this.notify();
    return result.bootstrap;
  }

  async shutdown(): Promise<void> {
    this.#stopping = true;
    const active = this.#active;
    if (!active) return;
    await this.#service.interruptRunning(active.agentTaskId, active.runtimeToken, "Stella 关闭，Agent 执行已中断");
    this.#active = undefined;
    await active.runtime.abortAndStop();
  }

  async #drain(): Promise<void> {
    if (this.#draining || this.#stopping || this.#active) return;
    this.#draining = true;
    let claimedWork = false;
    try {
      const claimed = await this.#service.claimNext();
      if (!claimed || this.#stopping) return;
      claimedWork = true;
      await this.#launch(claimed);
    } finally {
      this.#draining = false;
      if (claimedWork && !this.#active && !this.#stopping) this.notify();
    }
  }

  async #launch(claimed: ClaimedAgentTask): Promise<void> {
    const runtimeToken = claimed.agentTask.runtimeToken;
    if (!runtimeToken) throw new Error(`已认领 AgentTask ${claimed.agentTask.id} 缺少 runtimeToken`);
    const runtime = this.#runtimeFactory.create({
      emitPiEvent: (event) => void this.#handlePiEvent(claimed.agentTask.id, runtimeToken, event).catch((error) => this.#reportError(error)),
      emitRuntimeSignal: (signal) => this.#handleRuntimeSignal(claimed.agentTask.id, runtimeToken, signal),
    });
    const active: ActiveExecution = {
      taskId: claimed.task.id,
      agentTaskId: claimed.agentTask.id,
      runtimeToken,
      runtime,
      settling: false,
    };
    this.#active = active;
    const agent = claimed.agentTask.agentSnapshot;
    try {
      await runtime.start({
        cwd: claimed.task.projectPath,
        trusted: claimed.task.trusted,
        sessionName: `[Stella] ${claimed.task.title} · ${agent.name}`,
        provider: agent.provider,
        model: agent.model,
        thinking: agent.thinking,
        allowedTools: agent.allowedTools,
        appendSystemPrompt: agent.instructions,
        disableExtensions: agent.disableExtensions,
        disableSkills: agent.disableSkills,
        disablePromptTemplates: agent.disablePromptTemplates,
      });
      if (this.#active !== active || this.#stopping) {
        await runtime.stop();
        return;
      }
      await runtime.send({ type: "prompt", message: claimed.agentTask.prompt });
    } catch (error) {
      await this.#failActive(active, error);
    }
  }

  async #handlePiEvent(agentTaskId: string, runtimeToken: string, event: unknown): Promise<void> {
    const active = this.#active;
    if (!active || active.agentTaskId !== agentTaskId || active.runtimeToken !== runtimeToken) return;
    const eventType = stringField(event, "type") ?? "unknown";
    const toolName = stringField(event, "toolName") ?? stringField(event, "name");
    this.#emitBoardEvent({ type: "agent-task-event", taskId: active.taskId, agentTaskId, eventType, toolName });
    if (eventType === "agent_settled") {
      if (active.settling) return;
      active.settling = true;
      await this.#settle(active);
      return;
    }
    if (eventType === "tool_execution_start" || eventType === "tool_execution_end") {
      await this.#service.recordToolEvent(agentTaskId, runtimeToken, toolName ?? "工具", eventType === "tool_execution_start");
    }
  }

  #handleRuntimeSignal(agentTaskId: string, runtimeToken: string, signal: RuntimeSignal): void {
    const active = this.#active;
    if (!active || active.agentTaskId !== agentTaskId || active.runtimeToken !== runtimeToken) return;
    this.#emitBoardEvent({
      type: "agent-task-event",
      taskId: active.taskId,
      agentTaskId,
      eventType: signal.type,
      message: signal.type === "runtime_stderr" || signal.type === "protocol_error" ? signal.message : undefined,
    });
    if (signal.type === "runtime_exit") {
      void this.#failActive(active, new Error(`Pi RPC 意外退出 (code=${String(signal.code)}, signal=${String(signal.signal)})`)).catch((error) => this.#reportError(error));
    }
  }

  async #settle(active: ActiveExecution): Promise<void> {
    try {
      const [textResponse, stateResponse, statsResponse, messagesResponse] = await Promise.all([
        active.runtime.send({ type: "get_last_assistant_text" }),
        active.runtime.send({ type: "get_state" }),
        active.runtime.send({ type: "get_session_stats" }),
        active.runtime.send({ type: "get_messages" }),
      ]);
      if (this.#active !== active) return;
      const output = responseData<{ readonly text: string }>(textResponse, "get_last_assistant_text").text.trim();
      if (output.length === 0) throw new Error("Agent 已结束，但没有返回最终文本产物");
      const messages = responseData<{ readonly messages: readonly unknown[] }>(messagesResponse, "get_messages").messages;
      const lastAssistant = [...messages].reverse().map(record).find((message) => message?.role === "assistant");
      if (lastAssistant?.stopReason === "error" || lastAssistant?.stopReason === "aborted") {
        throw new Error(typeof lastAssistant.errorMessage === "string" ? lastAssistant.errorMessage : `Agent 以 ${lastAssistant.stopReason} 结束`);
      }
      const state = responseData<RpcStateData>(stateResponse, "get_state");
      const stats = responseData<RpcStatsData>(statsResponse, "get_session_stats");
      await this.#service.complete(active.agentTaskId, active.runtimeToken, {
        output,
        sessionPath: state.sessionFile,
        inputTokens: stats.tokens?.input,
        outputTokens: stats.tokens?.output,
        cost: stats.cost,
      });
      if (this.#active !== active) return;
      this.#active = undefined;
      await active.runtime.stop();
      this.notify();
    } catch (error) {
      await this.#failActive(active, error);
    }
  }

  async #failActive(active: ActiveExecution, cause: unknown): Promise<void> {
    if (this.#active !== active) return;
    try {
      await this.#service.fail(active.agentTaskId, active.runtimeToken, cause);
    } finally {
      if (this.#active === active) this.#active = undefined;
      await active.runtime.stop();
      this.notify();
    }
  }

  #reportError(cause: unknown): void {
    this.#emitBoardEvent({
      type: "automation-error",
      source: "agent-task-runner",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

import { randomUUID } from "node:crypto";
import type { PiCommand, PiResponse, RuntimeSignal } from "../shared/contracts";
import { backgroundSessionName } from "../shared/session-policy";
import {
  type AgentArtifact,
  type AgentDefinition,
  type BoardBootstrap,
  type BoardBridgeEvent,
  type BoardState,
  type KanbanTask,
  type OrchestrationCatalog,
  type ResolveGateInput,
  type StepRun,
  type TaskActivity,
  type WorkflowDefinition,
  type WorkflowRun,
} from "../shared/kanban";
import type { BoardRepository } from "./board-repository";
import { applyTaskLifecycle } from "../shared/task-lifecycle";
import { catalogForBoard } from "../shared/orchestration-catalog";
import { assertRequiredAgentSkills, requiredSkillsPrompt } from "./required-agent-skills";
import {
  WorkspaceAdmission,
  WorkspaceAdmissionAbortError,
  assertAgentWorkspacePolicy,
  type WorkspaceLease,
} from "./workspace-admission";
import { resolveAgentRuntimeModel, type RuntimeModelSelection } from "../shared/runtime-model";

export interface WorkflowAgentRuntime {
  readonly running: boolean;
  start(options: {
    readonly cwd: string;
    readonly trusted: boolean;
    readonly sessionName: string;
    readonly provider?: string;
    readonly model?: string;
    readonly thinking: AgentDefinition["thinking"];
    readonly allowedTools: readonly string[];
    readonly appendSystemPrompt: string;
    readonly disableExtensions: boolean;
    readonly disableSkills: boolean;
    readonly disablePromptTemplates: boolean;
  }): Promise<void>;
  send(command: PiCommand): Promise<PiResponse>;
  stop(): Promise<void>;
}

export interface WorkflowRuntimeFactory {
  create(callbacks: {
    readonly emitPiEvent: (event: unknown) => void;
    readonly emitRuntimeSignal: (signal: RuntimeSignal) => void;
  }): WorkflowAgentRuntime;
}

interface OrchestratorDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly runtimeFactory: WorkflowRuntimeFactory;
  readonly emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly admission: WorkspaceAdmission;
  readonly globalModel: () => RuntimeModelSelection | undefined;
  readonly resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string>;
  readonly now?: () => string;
  readonly id?: () => string;
}

interface ActiveAgentRun {
  readonly taskId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly runtime: WorkflowAgentRuntime;
  readonly lease?: WorkspaceLease;
  settling: boolean;
}

interface WaitingAdmission {
  readonly taskId: string;
  readonly controller: AbortController;
}

interface RpcStateData {
  readonly sessionFile?: string;
}

interface RpcStatsData {
  readonly tokens?: { readonly input?: number; readonly output?: number };
  readonly cost?: number;
}

function responseData<T>(response: PiResponse, command: string): T {
  if (!response.success) throw new Error(response.error);
  if (!("data" in response)) throw new Error(`Pi RPC 命令 ${command} 没有返回 data`);
  return response.data as T;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const found = record(value)?.[key];
  return typeof found === "string" ? found : undefined;
}

function cloneAgent(definition: AgentDefinition): AgentDefinition {
  return Object.freeze({ ...definition, allowedTools: Object.freeze([...definition.allowedTools]) });
}

function cloneWorkflow(definition: WorkflowDefinition): WorkflowDefinition {
  return Object.freeze({
    ...definition,
    steps: Object.freeze(definition.steps.map((step) => Object.freeze({ ...step }))),
  });
}

export class WorkflowOrchestrator {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #runtimeFactory: WorkflowRuntimeFactory;
  readonly #emitBoardEvent: (event: BoardBridgeEvent) => void;
  readonly #admission: WorkspaceAdmission;
  readonly #globalModel: () => RuntimeModelSelection | undefined;
  readonly #resolveProjectPath: (projectPath: string, trusted: boolean) => Promise<string>;
  readonly #now: () => string;
  readonly #id: () => string;
  readonly #activeAgents = new Map<string, ActiveAgentRun>();
  readonly #waitingAdmissions = new Map<string, WaitingAdmission>();
  #stopping = false;

  constructor(dependencies: OrchestratorDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#runtimeFactory = dependencies.runtimeFactory;
    this.#emitBoardEvent = dependencies.emitBoardEvent;
    this.#admission = dependencies.admission;
    this.#globalModel = dependencies.globalModel;
    this.#resolveProjectPath = dependencies.resolveProjectPath;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
  }

  async dispatch(taskId: string): Promise<BoardBootstrap> {
    if (this.#stopping) throw new Error("WorkflowOrchestrator 正在关闭");
    const now = this.#now();
    let runId = "";
    const bootstrap = await this.#commit((current) => {
      const task = this.#task(current, taskId);
      if (task.activeRunId || task.activeAgentTaskId) throw new Error("任务已有正在进行的执行");
      if (task.stage === "completed") throw new Error("已完成任务需先移回待规划列才能重新分发");
      if (task.executionTarget.kind !== "workflow") throw new Error("任务的执行目标不是固定流程");
      const workflowDefinition = this.#workflow(task.executionTarget.workflowId);
      const workflow = cloneWorkflow(workflowDefinition);
      const agentIds = new Set(workflow.steps.filter((step) => step.kind === "agent").map((step) => step.agentId));
      const agents = Object.freeze([...agentIds].map((id) => cloneAgent(this.#agent(id))));
      runId = this.#id();
      const run: WorkflowRun = Object.freeze({
        id: runId,
        taskId: task.id,
        workflow,
        agents,
        status: "queued",
        acceptance: "not-ready",
        steps: Object.freeze(workflow.steps.map((step) => Object.freeze({
          id: this.#id(),
          stepId: step.id,
          stepKind: step.kind,
          name: step.name,
          status: "pending" as const,
          agentId: step.kind === "agent" ? step.agentId : undefined,
        }))),
        startedAt: now,
        updatedAt: now,
      });
      const nextTask = applyTaskLifecycle(Object.freeze({
        ...task,
        activeRunId: run.id,
      }), { type: "execution-queued" }, now);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
        runs: [run, ...current.runs],
        activities: [...current.activities, this.#activity(task.id, "dispatch", `已分发「${workflow.shortName}」`, "等待第一个执行角色", now, run.id)],
      };
    });
    void this.#advance(runId).catch((error) => this.#failRun(runId, error)).catch((error) => this.#reportError(error));
    return bootstrap;
  }

  async resolveGate(input: ResolveGateInput): Promise<BoardBootstrap> {
    const now = this.#now();
    let runId = "";
    const bootstrap = await this.#commit((current) => {
      const task = this.#task(current, input.taskId);
      if (!task.activeRunId) throw new Error("任务当前没有等待处理的流程");
      const run = this.#run(current, task.activeRunId);
      runId = run.id;
      if (run.status !== "review" || !run.currentStepId) throw new Error("流程当前不在人工关卡");
      const step = run.steps.find((candidate) => candidate.stepId === run.currentStepId);
      if (!step || step.stepKind !== "human-gate" || step.status !== "waiting") {
        throw new Error("流程的人工关卡状态无效");
      }
      const comment = input.comment.trim();
      if (input.decision === "reject") {
        const rejectedStep: StepRun = Object.freeze({
          ...step,
          status: "failed",
          completedAt: now,
          error: comment || "用户驳回人工关卡",
        });
        const blockedRun: WorkflowRun = Object.freeze({
          ...run,
          status: "blocked",
          currentStepId: undefined,
          steps: Object.freeze(run.steps.map((candidate) => candidate.id === step.id ? rejectedStep : candidate)),
          updatedAt: now,
          completedAt: now,
        });
        const blockedTask = applyTaskLifecycle(Object.freeze({
          ...task,
          activeRunId: undefined,
        }), { type: "execution-failed", reason: comment || "人工关卡被驳回" }, now);
        return {
          ...current,
          tasks: current.tasks.map((candidate) => candidate.id === task.id ? blockedTask : candidate),
          runs: current.runs.map((candidate) => candidate.id === run.id ? blockedRun : candidate),
          activities: [...current.activities, this.#activity(task.id, "gate", `${step.name}已驳回`, comment || undefined, now, run.id, step.stepId)],
        };
      }

      const approvedStep: StepRun = Object.freeze({
        ...step,
        status: "succeeded",
        completedAt: now,
        artifact: Object.freeze({ title: `${step.name} · 人工决定`, content: comment || "已批准" }),
      });
      const runningRun: WorkflowRun = Object.freeze({
        ...run,
        status: "running",
        currentStepId: undefined,
        steps: Object.freeze(run.steps.map((candidate) => candidate.id === step.id ? approvedStep : candidate)),
        updatedAt: now,
      });
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(candidate, { type: "execution-queued" }, now)
          : candidate),
        runs: current.runs.map((candidate) => candidate.id === run.id ? runningRun : candidate),
        activities: [...current.activities, this.#activity(task.id, "gate", `${step.name}已批准`, comment || undefined, now, run.id, step.stepId)],
      };
    });
    if (input.decision === "approve") void this.#advance(runId).catch((error) => this.#failRun(runId, error)).catch((error) => this.#reportError(error));
    return bootstrap;
  }

  async abort(taskId: string): Promise<BoardBootstrap> {
    const state = await this.#repository.read();
    const task = this.#task(state, taskId);
    if (!task.activeRunId) throw new Error("任务当前没有可中止的流程");
    const runId = task.activeRunId;
    this.#waitingAdmissions.get(runId)?.controller.abort();
    const active = this.#activeAgents.get(runId);
    const now = this.#now();
    const bootstrap = await this.#commit((current) => {
      const latestTask = this.#task(current, taskId);
      const run = this.#run(current, runId);
      if (["failed", "blocked", "interrupted", "reported"].includes(run.status)) {
        throw new Error("流程已经进入终态，不能再次中止");
      }
      const interruptedRun: WorkflowRun = Object.freeze({
        ...run,
        status: "interrupted",
        currentStepId: undefined,
        steps: Object.freeze(run.steps.map((step) => step.status === "running" || step.status === "waiting"
          ? Object.freeze({ ...step, status: "interrupted" as const, completedAt: now, error: "用户中止" })
          : step)),
        updatedAt: now,
        completedAt: now,
      });
      const interruptedTask = applyTaskLifecycle(Object.freeze({
        ...latestTask,
        activeRunId: undefined,
      }), { type: "execution-interrupted", reason: "用户中止流程" }, now);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === taskId ? interruptedTask : candidate),
        runs: current.runs.map((candidate) => candidate.id === runId ? interruptedRun : candidate),
        activities: [...current.activities, this.#activity(taskId, "status", "流程已由用户中止", undefined, now, runId)],
      };
    });
    this.#activeAgents.delete(runId);
    if (active) {
      try {
        await active.runtime.stop();
      } finally {
        active.lease?.release();
      }
    }
    return bootstrap;
  }

  async shutdown(): Promise<void> {
    this.#stopping = true;
    for (const waiting of this.#waitingAdmissions.values()) waiting.controller.abort();
    const active = [...this.#activeAgents.values()];
    const now = this.#now();
    const activeRunIds = new Set([
      ...active.map((entry) => entry.runId),
      ...this.#waitingAdmissions.keys(),
    ]);
    if (activeRunIds.size > 0) {
      await this.#repository.update((current) => {
        const tasksByRunId = new Map(current.tasks.filter((task) => task.activeRunId).map((task) => [task.activeRunId as string, task]));
        const interruptedRunIds = new Set(current.runs
          .filter((run) => activeRunIds.has(run.id) && (run.status === "queued" || run.status === "running"))
          .map((run) => run.id));
        if (interruptedRunIds.size === 0) return current;
        const activities = [...interruptedRunIds].flatMap((runId) => {
          const task = tasksByRunId.get(runId);
          if (!task) return [];
          return [this.#activity(task.id, "error", "应用关闭，流程已中断", "运行进程已在持久化终态后停止。", now, runId)];
        });
        return {
          ...current,
          tasks: current.tasks.map((task) => task.activeRunId && interruptedRunIds.has(task.activeRunId)
            ? applyTaskLifecycle(Object.freeze({
                ...task,
                activeRunId: undefined,
              }), { type: "execution-interrupted", reason: "应用关闭，流程已中断" }, now)
            : task),
          runs: current.runs.map((run) => interruptedRunIds.has(run.id)
            ? Object.freeze({
                ...run,
                status: "interrupted" as const,
                currentStepId: undefined,
                steps: Object.freeze(run.steps.map((step) => step.status === "running"
                  ? Object.freeze({ ...step, status: "interrupted" as const, error: "应用关闭", completedAt: now })
                  : step)),
                updatedAt: now,
                completedAt: now,
              })
            : run),
          activities: [...current.activities, ...activities],
        };
      });
    }
    this.#activeAgents.clear();
    this.#waitingAdmissions.clear();
    await Promise.all(active.map(async (entry) => {
      try {
        await entry.runtime.stop();
      } finally {
        entry.lease?.release();
      }
    }));
  }

  async #advance(runId: string): Promise<void> {
    if (this.#stopping) return;
    const state = await this.#repository.read();
    const run = this.#run(state, runId);
    const task = this.#task(state, run.taskId);
    if (task.activeRunId !== run.id || ["blocked", "failed", "interrupted", "reported"].includes(run.status)) return;
    const step = run.steps.find((candidate) => candidate.status === "pending");
    if (!step) {
      await this.#completeRun(run, task);
      return;
    }
    const definition = run.workflow.steps.find((candidate) => candidate.id === step.stepId);
    if (!definition) throw new Error(`流程快照缺少步骤定义: ${step.stepId}`);
    if (definition.kind === "human-gate") {
      await this.#waitAtGate(run, task, step);
      return;
    }
    const agent = run.agents.find((candidate) => candidate.id === definition.agentId);
    if (!agent) throw new Error(`流程快照缺少 Agent: ${definition.agentId}`);
    assertAgentWorkspacePolicy(agent);
    let lease: WorkspaceLease | undefined;
    if (agent.workspaceAccess === "write") {
      const controller = new AbortController();
      const waiting = Object.freeze({ taskId: task.id, controller });
      this.#waitingAdmissions.set(run.id, waiting);
      try {
        lease = await this.#admission.acquireBackground(task.projectPath, {
          id: `workflow:${run.id}:${step.stepId}`,
          kind: "workflow",
          label: `Workflow · ${run.workflow.shortName} / ${agent.name}`,
          taskId: task.id,
          executionId: run.id,
        }, {
          signal: controller.signal,
          onQueued: (owner) => this.#queueForWriter(run, task, step, agent, owner.label),
        });
      } catch (cause) {
        if (cause instanceof WorkspaceAdmissionAbortError) return;
        throw cause;
      } finally {
        if (this.#waitingAdmissions.get(run.id) === waiting) this.#waitingAdmissions.delete(run.id);
      }
      if (this.#stopping) {
        lease.release();
        return;
      }
      const latest = await this.#repository.read();
      const latestTask = latest.tasks.find((candidate) => candidate.id === task.id);
      const latestRun = latest.runs.find((candidate) => candidate.id === run.id);
      const latestStep = latestRun?.steps.find((candidate) => candidate.id === step.id);
      if (latestTask?.activeRunId !== run.id || !latestRun || !latestStep || latestStep.status !== "pending" || ["failed", "blocked", "interrupted", "reported"].includes(latestRun.status)) {
        lease.release();
        return;
      }
    }
    await this.#startAgent(run, task, step, definition.objective, agent, lease);
  }

  async #waitAtGate(run: WorkflowRun, task: KanbanTask, step: StepRun): Promise<void> {
    const now = this.#now();
    await this.#commit((current) => {
      const latestRun = this.#run(current, run.id);
      const latestTask = this.#task(current, task.id);
      if (latestTask.activeRunId !== run.id || ["blocked", "failed", "interrupted", "reported"].includes(latestRun.status)) return current;
      const waitingStep: StepRun = Object.freeze({ ...step, status: "waiting", startedAt: now });
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(candidate, { type: "awaiting-human" }, now)
          : candidate),
        runs: current.runs.map((candidate) => candidate.id === run.id
          ? Object.freeze({
              ...latestRun,
              status: "review" as const,
              currentStepId: step.stepId,
              steps: Object.freeze(latestRun.steps.map((item) => item.id === step.id ? waitingStep : item)),
              updatedAt: now,
            })
          : candidate),
        activities: [...current.activities, this.#activity(task.id, "gate", `等待人工处理：${step.name}`, undefined, now, run.id, step.stepId)],
      };
    });
  }

  async #queueForWriter(run: WorkflowRun, task: KanbanTask, step: StepRun, agent: AgentDefinition, blockingOwner: string): Promise<void> {
    const now = this.#now();
    await this.#commit((current) => {
      const latestRun = this.#run(current, run.id);
      const latestTask = this.#task(current, task.id);
      if (latestTask.activeRunId !== run.id || ["blocked", "failed", "interrupted", "reported"].includes(latestRun.status)) return current;
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(candidate, { type: "execution-queued" }, now)
          : candidate),
        runs: current.runs.map((candidate) => candidate.id === run.id
          ? Object.freeze({ ...latestRun, status: "queued" as const, currentStepId: step.stepId, updatedAt: now })
          : candidate),
        activities: [...current.activities, this.#activity(task.id, "status", `${agent.name}等待项目写入席位`, `当前占用者：${blockingOwner}`, now, run.id, step.stepId)],
      };
    });
  }

  async #startAgent(
    run: WorkflowRun,
    task: KanbanTask,
    step: StepRun,
    objective: string,
    agent: AgentDefinition,
    lease?: WorkspaceLease,
  ): Promise<void> {
    const runtime = this.#runtimeFactory.create({
      emitPiEvent: (event) => void this.#handlePiEvent(run.id, event).catch((error) => this.#failRun(run.id, error)).catch((error) => this.#reportError(error)),
      emitRuntimeSignal: (signal) => this.#handleRuntimeSignal(run.id, signal),
    });
    const active: ActiveAgentRun = {
      taskId: task.id,
      runId: run.id,
      stepId: step.stepId,
      runtime,
      lease,
      settling: false,
    };
    this.#activeAgents.set(run.id, active);
    const selectedModel = resolveAgentRuntimeModel(agent, this.#globalModel());
    try {
      const projectPath = await this.#resolveProjectPath(task.projectPath, task.trusted);
      await runtime.start({
        cwd: projectPath,
        trusted: task.trusted,
        sessionName: backgroundSessionName({
          taskId: task.id,
          executionKind: "workflow-step",
          executionId: step.id,
          label: `${task.title} · ${step.name}`,
        }),
        provider: selectedModel.provider,
        model: selectedModel.model,
        thinking: agent.thinking,
        allowedTools: agent.allowedTools,
        appendSystemPrompt: requiredSkillsPrompt(agent),
        disableExtensions: agent.disableExtensions,
        disableSkills: agent.disableSkills,
        disablePromptTemplates: agent.disablePromptTemplates,
      });
      if (this.#activeAgents.get(run.id) !== active) {
        try {
          await runtime.stop();
        } finally {
          active.lease?.release();
        }
        return;
      }
      await assertRequiredAgentSkills(runtime, agent);
      if (this.#activeAgents.get(run.id) !== active) {
        try {
          await runtime.stop();
        } finally {
          active.lease?.release();
        }
        return;
      }
      const startedAt = this.#now();
      let applied = false;
      await this.#commit((current) => {
        const latestRun = this.#run(current, run.id);
        const latestTask = this.#task(current, task.id);
        applied = latestTask.activeRunId === run.id && !["blocked", "failed", "interrupted", "reported"].includes(latestRun.status);
        if (!applied) return current;
        const runningStep: StepRun = Object.freeze({ ...step, status: "running", startedAt });
        return {
          ...current,
          tasks: current.tasks.map((candidate) => candidate.id === task.id
            ? applyTaskLifecycle(candidate, { type: "execution-started" }, startedAt)
            : candidate),
          runs: current.runs.map((candidate) => candidate.id === run.id
            ? Object.freeze({
                ...latestRun,
                status: "running" as const,
                currentStepId: step.stepId,
                steps: Object.freeze(latestRun.steps.map((item) => item.id === step.id ? runningStep : item)),
                updatedAt: startedAt,
              })
            : candidate),
          activities: [...current.activities, this.#activity(task.id, "agent", `${agent.name}开始执行「${step.name}」`, agent.callsign, startedAt, run.id, step.stepId)],
        };
      });
      if (!applied) {
        if (this.#activeAgents.get(run.id) === active) this.#activeAgents.delete(run.id);
        try {
          await runtime.stop();
        } finally {
          active.lease?.release();
        }
        return;
      }
      await runtime.send({ type: "prompt", message: this.#promptFor(run, task, step, objective, agent) });
    } catch (error) {
      await this.#failRun(run.id, error);
    }
  }

  async #handlePiEvent(runId: string, event: unknown): Promise<void> {
    const active = this.#activeAgents.get(runId);
    if (!active) return;
    const eventType = stringField(event, "type") ?? "unknown";
    const toolName = stringField(event, "toolName") ?? stringField(event, "name");
    this.#emitBoardEvent({
      type: "agent-event",
      taskId: active.taskId,
      runId,
      stepId: active.stepId,
      eventType,
      toolName,
    });
    if (eventType === "agent_settled") {
      if (active.settling) return;
      active.settling = true;
      await this.#settleAgent(active);
      return;
    }
    if (eventType === "tool_execution_start" || eventType === "tool_execution_end") {
      const now = this.#now();
      await this.#commit((current) => ({
        ...current,
        activities: [...current.activities, this.#activity(
          active.taskId,
          "tool",
          `${toolName ?? "工具"}${eventType === "tool_execution_start" ? "开始运行" : "运行结束"}`,
          undefined,
          now,
          runId,
          active.stepId,
        )],
      }));
    }
  }

  #handleRuntimeSignal(runId: string, signal: RuntimeSignal): void {
    const active = this.#activeAgents.get(runId);
    if (!active) return;
    this.#emitBoardEvent({
      type: "agent-event",
      taskId: active.taskId,
      runId,
      stepId: active.stepId,
      eventType: signal.type,
      message: signal.type === "runtime_stderr" || signal.type === "protocol_error" ? signal.message : undefined,
    });
    if (signal.type === "runtime_exit") {
      void this.#failRun(runId, new Error(`Pi RPC 意外退出 (code=${String(signal.code)}, signal=${String(signal.signal)})`)).catch((error) => this.#reportError(error));
    }
  }

  async #settleAgent(active: ActiveAgentRun): Promise<void> {
    try {
      const [textResponse, stateResponse, statsResponse, messagesResponse] = await Promise.all([
        active.runtime.send({ type: "get_last_assistant_text" }),
        active.runtime.send({ type: "get_state" }),
        active.runtime.send({ type: "get_session_stats" }),
        active.runtime.send({ type: "get_messages" }),
      ]);
      const text = responseData<{ readonly text: string }>(textResponse, "get_last_assistant_text").text.trim();
      if (text.length === 0) throw new Error("Agent 已结束，但没有返回最终文本产物");
      const messages = responseData<{ readonly messages: readonly unknown[] }>(messagesResponse, "get_messages").messages;
      const lastAssistant = [...messages].reverse().map(record).find((message) => message?.role === "assistant");
      if (lastAssistant?.stopReason === "error" || lastAssistant?.stopReason === "aborted") {
        throw new Error(typeof lastAssistant.errorMessage === "string" ? lastAssistant.errorMessage : `Agent 以 ${lastAssistant.stopReason} 结束`);
      }
      const state = responseData<RpcStateData>(stateResponse, "get_state");
      const stats = responseData<RpcStatsData>(statsResponse, "get_session_stats");
      if (this.#activeAgents.get(active.runId) !== active) {
        try {
          await active.runtime.stop();
        } finally {
          active.lease?.release();
        }
        return;
      }
      const board = await this.#repository.read();
      const run = this.#run(board, active.runId);
      if (["failed", "blocked", "interrupted", "reported"].includes(run.status)) {
        this.#activeAgents.delete(active.runId);
        try {
          await active.runtime.stop();
        } finally {
          active.lease?.release();
        }
        return;
      }
      const step = run.steps.find((candidate) => candidate.stepId === active.stepId);
      if (!step) throw new Error(`找不到运行步骤: ${active.stepId}`);
      const artifact: AgentArtifact = Object.freeze({
        title: `${step.name} · Agent 产物`,
        content: text,
        sessionPath: state.sessionFile,
        inputTokens: stats.tokens?.input,
        outputTokens: stats.tokens?.output,
        cost: stats.cost,
      });
      const now = this.#now();
      await this.#commit((current) => {
        const latestRun = this.#run(current, active.runId);
        const latestTask = this.#task(current, active.taskId);
        if (this.#activeAgents.get(active.runId) !== active || latestTask.activeRunId !== active.runId || latestRun.status !== "running") {
          return current;
        }
        const completedStep: StepRun = Object.freeze({ ...step, status: "succeeded", completedAt: now, sessionPath: state.sessionFile, artifact });
        return {
          ...current,
          runs: current.runs.map((candidate) => candidate.id === active.runId
            ? Object.freeze({
                ...latestRun,
                status: "running" as const,
                currentStepId: undefined,
                steps: Object.freeze(latestRun.steps.map((item) => item.id === step.id ? completedStep : item)),
                updatedAt: now,
              })
            : candidate),
          activities: [...current.activities, this.#activity(active.taskId, "artifact", `${step.name}已产出结果`, state.sessionFile, now, active.runId, active.stepId)],
        };
      });
      this.#activeAgents.delete(active.runId);
      try {
        await active.runtime.stop();
      } finally {
        active.lease?.release();
      }
      await this.#advance(active.runId);
    } catch (error) {
      await this.#failRun(active.runId, error);
    }
  }

  async #completeRun(run: WorkflowRun, task: KanbanTask): Promise<void> {
    const now = this.#now();
    await this.#commit((current) => {
      const latestRun = this.#run(current, run.id);
      const latestTask = this.#task(current, task.id);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(Object.freeze({ ...latestTask, activeRunId: undefined }), { type: "execution-reported" }, now)
          : candidate),
        runs: current.runs.map((candidate) => candidate.id === run.id
          ? Object.freeze({ ...latestRun, status: "reported" as const, acceptance: "pending" as const, currentStepId: undefined, updatedAt: now, completedAt: now })
          : candidate),
        activities: [...current.activities, this.#activity(task.id, "status", "流程已完成", run.workflow.name, now, run.id)],
      };
    });
  }

  async #failRun(runId: string, cause: unknown): Promise<void> {
    const message = cause instanceof Error ? cause.message : String(cause);
    const active = this.#activeAgents.get(runId);
    this.#activeAgents.delete(runId);
    this.#waitingAdmissions.get(runId)?.controller.abort();
    if (active) {
      try {
        await active.runtime.stop();
      } finally {
        active.lease?.release();
      }
    }
    const state = await this.#repository.read();
    const run = state.runs.find((candidate) => candidate.id === runId);
    if (!run || ["failed", "blocked", "interrupted", "reported"].includes(run.status)) return;
    const task = this.#task(state, run.taskId);
    const now = this.#now();
    await this.#commit((current) => {
      const latestRun = this.#run(current, runId);
      const latestTask = this.#task(current, task.id);
      const failedStepId = latestRun.steps.find((step) => step.stepId === latestRun.currentStepId && step.status === "running")?.stepId
        ?? latestRun.steps.find((step) => step.status === "running" || step.status === "pending")?.stepId;
      const failedRun: WorkflowRun = Object.freeze({
        ...latestRun,
        status: "failed",
        currentStepId: undefined,
        steps: Object.freeze(latestRun.steps.map((step) => step.stepId === failedStepId
          ? Object.freeze({ ...step, status: "failed" as const, error: message, completedAt: now })
          : step)),
        updatedAt: now,
        completedAt: now,
      });
      const failedTask = applyTaskLifecycle(Object.freeze({
        ...latestTask,
        activeRunId: undefined,
      }), { type: "execution-failed", reason: message }, now);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id ? failedTask : candidate),
        runs: current.runs.map((candidate) => candidate.id === runId ? failedRun : candidate),
        activities: [...current.activities, this.#activity(task.id, "error", "流程执行失败", message, now, runId, latestRun.currentStepId)],
      };
    });
  }

  #reportError(cause: unknown): void {
    this.#emitBoardEvent({
      type: "automation-error",
      source: "workflow-orchestrator",
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }

  #promptFor(run: WorkflowRun, task: KanbanTask, step: StepRun, objective: string, agent: AgentDefinition): string {
    const artifacts = run.steps
      .filter((candidate) => candidate.artifact)
      .map((candidate) => `### ${candidate.name}\n${candidate.artifact?.content ?? ""}`)
      .join("\n\n");
    return [
      `# Stella 固定流程任务`,
      ``,
      `项目：${task.projectName}`,
      `任务：${task.title}`,
      `当前步骤：${step.name}`,
      `执行角色：${agent.name}（${agent.callsign}）`,
      ``,
      `## 任务说明`,
      task.description || "（未提供补充说明）",
      ``,
      `## 验收标准`,
      task.acceptanceCriteria || "（未提供补充标准，请以任务目标和项目约束为准）",
      ``,
      `## 当前步骤目标`,
      objective,
      ``,
      `## 角色固定指令`,
      agent.instructions,
      ``,
      `## 上游产物`,
      artifacts || "（这是第一个 Agent 步骤）",
      ``,
      `只完成当前角色职责。最终回复必须是一份可交给下一角色或人工关卡的独立产物，并如实写明失败和未验证项。`,
    ].join("\n");
  }

  #task(state: BoardState, taskId: string): KanbanTask {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`找不到任务: ${taskId}`);
    return task;
  }

  #run(state: BoardState, runId: string): WorkflowRun {
    const run = state.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`找不到流程实例: ${runId}`);
    return run;
  }

  #workflow(workflowId: string): WorkflowDefinition {
    const workflow = this.#catalog.workflows.find((candidate) => candidate.id === workflowId);
    if (!workflow) throw new Error(`未知流程模板: ${workflowId}`);
    return workflow;
  }

  #agent(agentId: string): AgentDefinition {
    const agent = this.#catalog.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`未知 Agent: ${agentId}`);
    return agent;
  }

  #activity(
    taskId: string,
    kind: TaskActivity["kind"],
    summary: string,
    detail: string | undefined,
    now: string,
    runId?: string,
    stepId?: string,
  ): TaskActivity {
    return Object.freeze({ id: this.#id(), taskId, runId, stepId, kind, summary, detail, createdAt: now });
  }

  async #commit(transform: (current: BoardState) => BoardState): Promise<BoardBootstrap> {
    const board = await this.#repository.update(transform);
    const bootstrap = Object.freeze({ board, catalog: catalogForBoard(this.#catalog, board) });
    this.#emitBoardEvent({ type: "snapshot", bootstrap });
    return bootstrap;
  }
}

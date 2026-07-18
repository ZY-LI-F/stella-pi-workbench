import { randomUUID } from "node:crypto";
import type { BoardRepository } from "./board-repository";
import { availableMentionAgentsForTask, parseAgentMentions } from "../shared/agent-mentions";
import {
  isTerminalAgentTaskStatus,
  type AgentDefinition,
  type AgentTask,
  type BoardBootstrap,
  type BoardState,
  type CreateTaskCommentInput,
  type KanbanTask,
  type OrchestrationCatalog,
  type Squad,
  type TaskActivity,
  type TaskComment,
} from "../shared/kanban";

interface AgentTaskServiceDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly now?: () => string;
  readonly id?: () => string;
}

export interface ClaimedAgentTask {
  readonly task: KanbanTask;
  readonly agentTask: AgentTask;
}

export interface AgentTaskResult {
  readonly output: string;
  readonly sessionPath?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
}

export interface AbortedAgentTask {
  readonly bootstrap: BoardBootstrap;
  readonly agentTaskId: string;
  readonly runningAgentTaskId?: string;
  readonly wasRunning: boolean;
}

function cloneAgent(agent: AgentDefinition): AgentDefinition {
  return Object.freeze({ ...agent, allowedTools: Object.freeze([...agent.allowedTools]) });
}

function normalizedRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label}不能为空`);
  return normalized;
}

export class AgentTaskService {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly #now: () => string;
  readonly #id: () => string;

  constructor(dependencies: AgentTaskServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#emitChanged = dependencies.emitChanged;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
  }

  async addComment(input: CreateTaskCommentInput): Promise<BoardBootstrap> {
    const body = normalizedRequired(input.body, "评论内容");
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#task(current, input.taskId);
      const availableAgents = availableMentionAgentsForTask(task, this.#catalog, current.squads);
      const mentions = parseAgentMentions(body, availableAgents).agents;
      if (mentions.length > 0 && (task.activeRunId || task.activeAgentTaskId)) {
        throw new Error("任务正在执行；请先中止或等待完成后再使用 @mention 分发");
      }
      if (mentions.length > 0 && task.stage === "completed") {
        throw new Error("已完成任务需先移回待规划列才能使用 @mention 分发");
      }

      const comment: TaskComment = Object.freeze({ id: this.#id(), taskId: task.id, author: "user", messageKind: "comment", body, createdAt: now });
      const activities: TaskActivity[] = [this.#activity(task.id, "comment", "用户添加了评论", body, now)];
      if (mentions.length === 0) {
        return { ...current, comments: [...current.comments, comment], activities: [...current.activities, ...activities] };
      }

      const comments = [...current.comments.filter((candidate) => candidate.taskId === task.id), comment];
      const rootAgent = mentions[0];
      if (!rootAgent) throw new Error("mention 解析结果缺少根 Agent");
      const rootId = this.#id();
      const squadId = task.executionTarget.kind === "squad" ? task.executionTarget.squadId : undefined;
      const root: AgentTask = Object.freeze({
        id: rootId,
        taskId: task.id,
        agentSnapshot: cloneAgent(rootAgent),
        kind: mentions.length > 1 ? "mention-root" : "direct",
        status: "queued",
        acceptance: "not-ready",
        prompt: this.#promptFor(task, rootAgent, comments),
        squadId,
        createdAt: now,
        updatedAt: now,
      });
      const children = mentions.slice(1).map((agent) => Object.freeze({
        id: this.#id(),
        taskId: task.id,
        agentSnapshot: cloneAgent(agent),
        kind: "delegated" as const,
        status: "queued" as const,
        acceptance: "not-ready" as const,
        prompt: this.#mentionPrompt(task, agent, body),
        parentAgentTaskId: rootId,
        squadId,
        createdAt: now,
        updatedAt: now,
      }));
      const nextTask: KanbanTask = Object.freeze({ ...task, activeAgentTaskId: rootId, updatedAt: now });
      activities.push(this.#activity(task.id, "dispatch", `评论已分发给 ${mentions.map((agent) => agent.name).join("、")}`, body, now, rootId));
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
        comments: [...current.comments, comment],
        agentTasks: [...current.agentTasks, root, ...children],
        activities: [...current.activities, ...activities],
      };
    });
  }

  async dispatchDirect(taskId: string): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#dispatchableTask(current, taskId);
      if (task.executionTarget.kind !== "agent") throw new Error("任务的执行目标不是单 Agent");
      const agent = this.#agent(task.executionTarget.agentId);
      const agentTask = this.#rootAgentTask(
        task,
        agent,
        "direct",
        this.#promptFor(task, agent, current.comments.filter((comment) => comment.taskId === task.id)),
        now,
      );
      return this.#withDispatchedRoot(current, task, agentTask, `已分发给 ${agent.name}`, `@${agent.id}`, now);
    });
  }

  async dispatchSquad(taskId: string): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const task = this.#dispatchableTask(current, taskId);
      if (task.executionTarget.kind !== "squad") throw new Error("任务的执行目标不是 Squad");
      const squad = this.#squad(current, task.executionTarget.squadId);
      const leader = this.#agent(squad.leaderAgentId);
      const members = squad.memberAgentIds.map((agentId) => this.#agent(agentId));
      const agentTask = this.#rootAgentTask(task, leader, "squad-leader", this.#squadLeaderPrompt(
        task,
        squad,
        leader,
        members,
        current.comments.filter((comment) => comment.taskId === task.id),
      ), now, squad.id);
      return this.#withDispatchedRoot(current, task, agentTask, `Squad「${squad.name}」已启动`, `${leader.name} 担任 Leader`, now);
    });
  }

  async nextQueued(): Promise<ClaimedAgentTask | undefined> {
    const current = await this.#repository.read();
    if (current.agentTasks.some((agentTask) => agentTask.status === "running")) return undefined;
    const next = [...current.agentTasks]
      .filter((agentTask) => agentTask.status === "queued")
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id))[0];
    if (!next) return undefined;
    const task = this.#task(current, next.taskId);
    const rootId = this.#rootAgentTaskId(current, next);
    if (task.activeAgentTaskId !== rootId) throw new Error(`AgentTask ${next.id} 与任务的 activeAgentTaskId 不一致`);
    return Object.freeze({ task, agentTask: next });
  }

  async claim(agentTaskId: string): Promise<ClaimedAgentTask | undefined> {
    const runtimeToken = this.#id();
    const now = this.#now();
    let claimed = false;
    const board = await this.#repository.update((current) => {
      if (current.agentTasks.some((agentTask) => agentTask.status === "running")) return current;
      const next = current.agentTasks.find((agentTask) => agentTask.id === agentTaskId);
      if (!next || next.status !== "queued") return current;
      const task = this.#task(current, next.taskId);
      const rootId = this.#rootAgentTaskId(current, next);
      if (task.activeAgentTaskId !== rootId) throw new Error(`AgentTask ${next.id} 与任务的 activeAgentTaskId 不一致`);
      claimed = true;
      const running: AgentTask = Object.freeze({ ...next, status: "running", runtimeToken, startedAt: now, updatedAt: now });
      return {
        ...current,
        agentTasks: current.agentTasks.map((candidate) => candidate.id === next.id ? running : candidate),
        activities: [...current.activities, this.#activity(task.id, "agent", `${next.agentSnapshot.name}开始执行`, next.kind, now, next.id)],
      };
    });
    if (!claimed) return undefined;
    const bootstrap = Object.freeze({ board, catalog: this.#catalog });
    this.#emitChanged(bootstrap);
    const agentTask = board.agentTasks.find((candidate) => candidate.id === agentTaskId);
    if (!agentTask) throw new Error(`认领后找不到 AgentTask: ${agentTaskId}`);
    return Object.freeze({ task: this.#task(board, agentTask.taskId), agentTask });
  }

  async recordWorkspaceWait(agentTaskId: string, blockingOwner: string): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#agentTask(current, agentTaskId);
      if (agentTask.status !== "queued") return current;
      return {
        ...current,
        activities: [...current.activities, this.#activity(
          agentTask.taskId,
          "status",
          `${agentTask.agentSnapshot.name}等待项目写入席位`,
          `当前占用者：${blockingOwner}`,
          now,
          agentTask.id,
        )],
      };
    });
  }

  async rejectQueued(agentTaskId: string, cause: unknown): Promise<BoardBootstrap> {
    const message = cause instanceof Error ? cause.message : String(cause);
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#agentTask(current, agentTaskId);
      if (agentTask.status !== "queued") throw new Error(`AgentTask ${agentTaskId} 不在 queued 状态`);
      const task = this.#task(current, agentTask.taskId);
      const rootId = this.#rootAgentTaskId(current, agentTask);
      const groupIds = this.#agentTaskGroupIds(current, rootId);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? Object.freeze({ ...task, activeAgentTaskId: undefined, updatedAt: now })
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => {
          if (candidate.id === agentTask.id) return Object.freeze({ ...candidate, status: "failed" as const, error: message, updatedAt: now, completedAt: now });
          if (!groupIds.has(candidate.id) || isTerminalAgentTaskStatus(candidate.status)) return candidate;
          if (candidate.id === rootId) return Object.freeze({ ...candidate, status: "failed" as const, error: `子任务无法启动：${message}`, updatedAt: now, completedAt: now });
          return Object.freeze({ ...candidate, status: "cancelled" as const, error: "同组 AgentTask 无法安全启动", updatedAt: now, completedAt: now });
        }),
        activities: [...current.activities, this.#activity(task.id, "error", `${agentTask.agentSnapshot.name}未通过启动前权限验证`, message, now, agentTask.id)],
      };
    });
  }

  async reconcileWaitingParents(): Promise<BoardBootstrap | undefined> {
    const current = await this.#repository.read();
    const brokenParents = current.agentTasks.filter((candidate) => {
      if (candidate.status !== "waiting_children") return false;
      const children = current.agentTasks.filter((child) => child.parentAgentTaskId === candidate.id);
      return children.some((child) => child.status === "failed" || child.status === "interrupted" || child.status === "cancelled");
    });
    if (brokenParents.length === 0) return undefined;
    const now = this.#now();
    const brokenIds = new Set(brokenParents.map((parent) => parent.id));
    return this.#commit((state) => {
      const activities = brokenParents.map((parent) => this.#activity(
        parent.taskId,
        "error",
        "父 AgentTask 因子任务终态失败",
        "应用恢复时发现失败、中断或取消的子任务。",
        now,
        parent.id,
      ));
      return {
        ...state,
        tasks: state.tasks.map((task) => task.activeAgentTaskId && brokenIds.has(task.activeAgentTaskId)
          ? Object.freeze({
              ...task,
              activeAgentTaskId: undefined,
              updatedAt: now,
            })
          : task),
        agentTasks: state.agentTasks.map((agentTask) => {
          if (brokenIds.has(agentTask.id)) {
            return Object.freeze({ ...agentTask, status: "failed" as const, error: "子 AgentTask 未成功完成", updatedAt: now, completedAt: now });
          }
          if (agentTask.parentAgentTaskId && brokenIds.has(agentTask.parentAgentTaskId) && !isTerminalAgentTaskStatus(agentTask.status)) {
            return Object.freeze({ ...agentTask, status: "cancelled" as const, runtimeToken: undefined, error: "父 AgentTask 已失败", updatedAt: now, completedAt: now });
          }
          return agentTask;
        }),
        activities: [...state.activities, ...activities],
      };
    });
  }

  async complete(agentTaskId: string, runtimeToken: string, result: AgentTaskResult): Promise<BoardBootstrap> {
    const output = normalizedRequired(result.output, "Agent 最终输出");
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#runningAgentTask(current, agentTaskId, runtimeToken);
      const task = this.#task(current, agentTask.taskId);
      const resultFields = Object.freeze({
        runtimeToken: undefined,
        output,
        sessionPath: result.sessionPath,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cost: result.cost,
        updatedAt: now,
      });
      const comment: TaskComment = Object.freeze({
        id: this.#id(), taskId: task.id, author: "agent", authorAgentId: agentTask.agentSnapshot.id,
        messageKind: "execution-report", agentTaskId: agentTask.id, body: output, createdAt: now,
      });
      const baseActivities = [...current.activities, this.#activity(task.id, "artifact", `${agentTask.agentSnapshot.name}已产出结果`, result.sessionPath, now, agentTask.id)];

      if (agentTask.kind === "squad-leader") {
        const squad = this.#squad(current, agentTask.squadId ?? "");
        const members = squad.memberAgentIds.map((agentId) => this.#agent(agentId));
        const delegatedAgents = parseAgentMentions(output, members).agents;
        if (delegatedAgents.length > 0) {
          const children = delegatedAgents.map((agent) => Object.freeze({
            id: this.#id(),
            taskId: task.id,
            agentSnapshot: cloneAgent(agent),
            kind: "delegated" as const,
            status: "queued" as const,
            acceptance: "not-ready" as const,
            prompt: this.#delegatedPrompt(task, squad, agent, output),
            parentAgentTaskId: agentTask.id,
            squadId: squad.id,
            createdAt: now,
            updatedAt: now,
          }));
          const waitingLeader: AgentTask = Object.freeze({ ...agentTask, ...resultFields, status: "waiting_children" });
          return {
            ...current,
            agentTasks: [...current.agentTasks.map((candidate) => candidate.id === agentTask.id ? waitingLeader : candidate), ...children],
            comments: [...current.comments, comment],
            activities: [...baseActivities, this.#activity(task.id, "dispatch", `Leader 委派给 ${delegatedAgents.map((agent) => agent.name).join("、")}`, output, now, agentTask.id)],
          };
        }
      }

      if (agentTask.kind === "mention-root") {
        const children = current.agentTasks.filter((candidate) => candidate.parentAgentTaskId === agentTask.id);
        if (children.length === 0) throw new Error(`mention root ${agentTask.id} 缺少子任务`);
        const waitingRoot: AgentTask = Object.freeze({ ...agentTask, ...resultFields, status: "waiting_children" });
        return {
          ...current,
          agentTasks: current.agentTasks.map((candidate) => candidate.id === agentTask.id ? waitingRoot : candidate),
          comments: [...current.comments, comment],
          activities: baseActivities,
        };
      }

      const reported: AgentTask = Object.freeze({
        ...agentTask,
        ...resultFields,
        status: "reported",
        acceptance: agentTask.parentAgentTaskId ? "not-ready" : "pending",
        completedAt: now,
      });
      if (agentTask.kind === "delegated") {
        const parent = this.#agentTask(current, agentTask.parentAgentTaskId ?? "");
        if (parent.status !== "waiting_children") throw new Error(`父 AgentTask ${parent.id} 未在等待子任务`);
        const children = current.agentTasks
          .filter((candidate) => candidate.parentAgentTaskId === parent.id)
          .map((candidate) => candidate.id === agentTask.id ? reported : candidate);
        const allReported = children.every((candidate) => candidate.status === "reported");
        const completedParent: AgentTask = allReported
          ? Object.freeze({ ...parent, status: "reported", acceptance: "pending", updatedAt: now, completedAt: now })
          : parent;
        return {
          ...current,
          tasks: current.tasks.map((candidate) => candidate.id === task.id
            ? Object.freeze({
                ...task,
                activeAgentTaskId: allReported ? undefined : task.activeAgentTaskId,
                updatedAt: allReported ? now : task.updatedAt,
              })
            : candidate),
          agentTasks: current.agentTasks.map((candidate) => {
            if (candidate.id === agentTask.id) return reported;
            if (candidate.id === parent.id) return completedParent;
            return candidate;
          }),
          comments: [...current.comments, comment],
          activities: allReported
            ? [...baseActivities, this.#activity(task.id, "status", "所有 Squad/mention 子任务已完成", undefined, now, parent.id)]
            : baseActivities,
        };
      }

      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? Object.freeze({ ...task, activeAgentTaskId: undefined, updatedAt: now })
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => candidate.id === agentTask.id ? reported : candidate),
        comments: [...current.comments, comment],
        activities: baseActivities,
      };
    });
  }

  async fail(agentTaskId: string, runtimeToken: string, cause: unknown): Promise<BoardBootstrap> {
    const message = cause instanceof Error ? cause.message : String(cause);
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#runningAgentTask(current, agentTaskId, runtimeToken);
      const task = this.#task(current, agentTask.taskId);
      const rootId = this.#rootAgentTaskId(current, agentTask);
      const groupIds = this.#agentTaskGroupIds(current, rootId);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? Object.freeze({ ...task, activeAgentTaskId: undefined, updatedAt: now })
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => {
          if (candidate.id === agentTask.id) return Object.freeze({ ...candidate, status: "failed" as const, runtimeToken: undefined, error: message, updatedAt: now, completedAt: now });
          if (!groupIds.has(candidate.id) || isTerminalAgentTaskStatus(candidate.status)) return candidate;
          if (candidate.id === rootId) return Object.freeze({ ...candidate, status: "failed" as const, runtimeToken: undefined, error: `子任务失败：${message}`, updatedAt: now, completedAt: now });
          return Object.freeze({ ...candidate, status: "cancelled" as const, runtimeToken: undefined, error: "同组 AgentTask 已失败", updatedAt: now, completedAt: now });
        }),
        activities: [...current.activities, this.#activity(task.id, "error", `${agentTask.agentSnapshot.name}执行失败`, message, now, agentTask.id)],
      };
    });
  }

  async abortTask(taskId: string): Promise<AbortedAgentTask> {
    const now = this.#now();
    let rootId = "";
    let runningAgentTaskId: string | undefined;
    const bootstrap = await this.#commit((current) => {
      const task = this.#task(current, taskId);
      if (!task.activeAgentTaskId) throw new Error("任务当前没有可中止的 Agent 执行");
      const root = this.#agentTask(current, task.activeAgentTaskId);
      if (isTerminalAgentTaskStatus(root.status)) throw new Error("AgentTask 已经进入终态");
      rootId = root.id;
      const groupIds = this.#agentTaskGroupIds(current, root.id);
      const running = current.agentTasks.find((candidate) => groupIds.has(candidate.id) && candidate.status === "running");
      runningAgentTaskId = running?.id;
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? Object.freeze({
              ...task,
              activeAgentTaskId: undefined,
              updatedAt: now,
            })
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => {
          if (!groupIds.has(candidate.id) || isTerminalAgentTaskStatus(candidate.status)) return candidate;
          const wasRunning = candidate.status === "running";
          return Object.freeze({
            ...candidate,
            status: wasRunning ? "interrupted" as const : "cancelled" as const,
            runtimeToken: undefined,
            error: wasRunning ? "用户中止 Agent 执行" : "用户取消同组排队执行",
            updatedAt: now,
            completedAt: now,
          });
        }),
        activities: [...current.activities, this.#activity(task.id, "status", running ? "Agent 执行已由用户中止" : "排队执行已由用户取消", undefined, now, root.id)],
      };
    });
    return Object.freeze({ bootstrap, agentTaskId: rootId, runningAgentTaskId, wasRunning: runningAgentTaskId !== undefined });
  }

  async interruptRunning(agentTaskId: string, runtimeToken: string, reason: string): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#runningAgentTask(current, agentTaskId, runtimeToken);
      const task = this.#task(current, agentTask.taskId);
      const rootId = this.#rootAgentTaskId(current, agentTask);
      const groupIds = this.#agentTaskGroupIds(current, rootId);
      return {
        ...current,
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? Object.freeze({ ...task, activeAgentTaskId: undefined, updatedAt: now })
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => {
          if (!groupIds.has(candidate.id) || isTerminalAgentTaskStatus(candidate.status)) return candidate;
          return Object.freeze({
            ...candidate,
            status: candidate.id === agentTask.id || candidate.id === rootId ? "interrupted" as const : "cancelled" as const,
            runtimeToken: undefined,
            error: candidate.id === agentTask.id || candidate.id === rootId ? reason : "同组运行在应用关闭时取消",
            updatedAt: now,
            completedAt: now,
          });
        }),
        activities: [...current.activities, this.#activity(task.id, "error", "Agent 执行已中断", reason, now, agentTask.id)],
      };
    });
  }

  async recordToolEvent(agentTaskId: string, runtimeToken: string, toolName: string, started: boolean): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const agentTask = this.#runningAgentTask(current, agentTaskId, runtimeToken);
      return {
        ...current,
        activities: [...current.activities, this.#activity(agentTask.taskId, "tool", `${toolName}${started ? "开始运行" : "运行结束"}`, undefined, now, agentTask.id)],
      };
    });
  }

  async read(): Promise<BoardState> {
    return this.#repository.read();
  }

  #dispatchableTask(state: BoardState, taskId: string): KanbanTask {
    const task = this.#task(state, taskId);
    if (task.activeRunId || task.activeAgentTaskId) throw new Error("任务已有正在进行的执行");
    if (task.stage === "completed") throw new Error("已完成任务需先移回待规划列才能重新分发");
    return task;
  }

  #rootAgentTask(
    task: KanbanTask,
    agent: AgentDefinition,
    kind: "direct" | "squad-leader",
    prompt: string,
    now: string,
    squadId?: string,
  ): AgentTask {
    return Object.freeze({
      id: this.#id(), taskId: task.id, agentSnapshot: cloneAgent(agent), kind, status: "queued", acceptance: "not-ready", prompt, squadId, createdAt: now, updatedAt: now,
    });
  }

  #withDispatchedRoot(
    state: BoardState,
    task: KanbanTask,
    agentTask: AgentTask,
    summary: string,
    detail: string,
    now: string,
  ): BoardState {
    const nextTask: KanbanTask = Object.freeze({ ...task, activeAgentTaskId: agentTask.id, updatedAt: now });
    return {
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate),
      agentTasks: [...state.agentTasks, agentTask],
      activities: [...state.activities, this.#activity(task.id, "dispatch", summary, detail, now, agentTask.id)],
    };
  }

  #runningAgentTask(state: BoardState, agentTaskId: string, runtimeToken: string): AgentTask {
    const agentTask = this.#agentTask(state, agentTaskId);
    if (agentTask.status !== "running" || agentTask.runtimeToken !== runtimeToken) throw new Error(`AgentTask ${agentTaskId} 的 Runtime 已失效`);
    return agentTask;
  }

  #rootAgentTaskId(state: BoardState, agentTask: AgentTask): string {
    let current = agentTask;
    const visited = new Set<string>();
    while (current.parentAgentTaskId) {
      if (visited.has(current.id)) throw new Error(`AgentTask ${agentTask.id} 存在循环父子关系`);
      visited.add(current.id);
      current = this.#agentTask(state, current.parentAgentTaskId);
    }
    return current.id;
  }

  #agentTaskGroupIds(state: BoardState, rootId: string): ReadonlySet<string> {
    const ids = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of state.agentTasks) {
        if (candidate.parentAgentTaskId && ids.has(candidate.parentAgentTaskId) && !ids.has(candidate.id)) {
          ids.add(candidate.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  #task(state: BoardState, taskId: string): KanbanTask {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`找不到任务: ${taskId}`);
    return task;
  }

  #agentTask(state: BoardState, agentTaskId: string): AgentTask {
    const agentTask = state.agentTasks.find((candidate) => candidate.id === agentTaskId);
    if (!agentTask) throw new Error(`找不到 AgentTask: ${agentTaskId}`);
    return agentTask;
  }

  #squad(state: BoardState, squadId: string): Squad {
    const squad = state.squads.find((candidate) => candidate.id === squadId);
    if (!squad) throw new Error(`找不到 Squad: ${squadId}`);
    return squad;
  }

  #agent(agentId: string): AgentDefinition {
    const agent = this.#catalog.agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`未知 Agent: ${agentId}`);
    return agent;
  }

  #promptFor(task: KanbanTask, agent: AgentDefinition, comments: readonly TaskComment[]): string {
    const discussion = comments.map((comment) => `- ${comment.author === "user" ? "用户" : comment.authorAgentId ?? comment.author}：${comment.body}`).join("\n");
    return [
      "# Stella 单 Agent 任务", "", `项目：${task.projectName}`, `任务：${task.title}`,
      `执行角色：${agent.name}（@${agent.id} / ${agent.callsign}）`, "", "## 任务说明",
      task.description || "（未提供补充说明）", "", "## 验收标准",
      task.acceptanceCriteria || "（未提供补充标准，请以任务目标和项目约束为准）", "", "## 任务讨论",
      discussion || "（暂无评论）", "", "只完成当前角色职责。必须真实操作并验证；最终回复是一份独立结果，明确写出失败和未验证项。",
    ].join("\n");
  }

  #squadLeaderPrompt(
    task: KanbanTask,
    squad: Squad,
    leader: AgentDefinition,
    members: readonly AgentDefinition[],
    comments: readonly TaskComment[],
  ): string {
    const memberList = members.map((agent) => `- @${agent.id}（${agent.callsign}）：${agent.responsibility}`).join("\n");
    const discussion = comments.map((comment) => `- ${comment.author === "user" ? "用户" : comment.authorAgentId ?? comment.author}：${comment.body}`).join("\n");
    return [
      "# Stella Squad Leader 任务", "", `Squad：${squad.name}`, `Leader：${leader.name}`, `任务：${task.title}`,
      "", "## 任务说明", task.description || "（未提供补充说明）", "", "## 验收标准",
      task.acceptanceCriteria || "（未提供补充标准）", "", "## 任务讨论", discussion || "（暂无评论）",
      "", "## 可委派成员", memberList, "", "## Leader 指令", squad.leaderInstructions,
      "", "先完成 Leader 的分析或工作。若确实需要成员继续执行，只在最终回复中使用上述精确别名 @mention；Stella 会为每个被提及成员创建真实子 AgentTask。不要声称成员已经执行。未提及任何成员表示无需委派。",
    ].join("\n");
  }

  #delegatedPrompt(task: KanbanTask, squad: Squad, agent: AgentDefinition, leaderOutput: string): string {
    return [
      "# Stella Squad 子任务", "", `Squad：${squad.name}`, `任务：${task.title}`, `执行成员：${agent.name}（@${agent.id}）`,
      "", "## 任务说明", task.description || "（未提供补充说明）", "", "## 验收标准",
      task.acceptanceCriteria || "（未提供补充标准）", "", "## Leader 产物与委派上下文", leaderOutput,
      "", "只执行你的成员职责。真实操作并验证，最终明确报告结果、失败和未验证项。",
    ].join("\n");
  }

  #mentionPrompt(task: KanbanTask, agent: AgentDefinition, comment: string): string {
    return [
      "# Stella @mention 委派任务", "", `任务：${task.title}`, `执行角色：${agent.name}（@${agent.id}）`,
      "", "## 用户委派评论", comment, "", "## 任务说明", task.description || "（未提供补充说明）",
      "", "## 验收标准", task.acceptanceCriteria || "（未提供补充标准）",
      "", "完成被提及角色的真实工作并验证；最终明确报告结果、失败和未验证项。",
    ].join("\n");
  }

  #activity(
    taskId: string,
    kind: TaskActivity["kind"],
    summary: string,
    detail: string | undefined,
    now: string,
    agentTaskId?: string,
  ): TaskActivity {
    return Object.freeze({ id: this.#id(), taskId, agentTaskId, kind, summary, detail, createdAt: now });
  }

  async #commit(transform: (current: BoardState) => BoardState): Promise<BoardBootstrap> {
    const board = await this.#repository.update(transform);
    const bootstrap = Object.freeze({ board, catalog: this.#catalog });
    this.#emitChanged(bootstrap);
    return bootstrap;
  }
}

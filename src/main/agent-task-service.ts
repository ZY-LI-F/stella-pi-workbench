import { randomUUID } from "node:crypto";
import type { BoardRepository } from "./board-repository";
import { availableMentionAgentsForTask, parseAgentMentions } from "../shared/agent-mentions";
import { coordinatorActionMessage, parseCoordinatorAction, type CoordinatorAction, type CoordinatorDelegation } from "../shared/coordinator-protocol";
import { catalogForBoard } from "../shared/orchestration-catalog";
import { applyTaskLifecycle } from "../shared/task-lifecycle";
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

interface AgentTaskResultFields {
  readonly runtimeToken: undefined;
  readonly output: string;
  readonly sessionPath?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
  readonly updatedAt: string;
}

export interface AbortedAgentTask {
  readonly bootstrap: BoardBootstrap;
  readonly agentTaskId: string;
  readonly runningAgentTaskId?: string;
  readonly wasRunning: boolean;
}

function cloneAgent(agent: AgentDefinition): AgentDefinition {
  return Object.freeze({
    ...agent,
    allowedTools: Object.freeze([...agent.allowedTools]),
    requiredSkills: agent.requiredSkills ? Object.freeze([...agent.requiredSkills]) : undefined,
  });
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
      const availableAgents = availableMentionAgentsForTask(task, this.#catalogFor(current), current.squads);
      const mentions = parseAgentMentions(body, availableAgents).agents;
      const activeRoot = task.activeAgentTaskId ? this.#agentTask(current, task.activeAgentTaskId) : undefined;
      const resumingCoordinator = mentions.length === 0 && activeRoot?.kind === "coordinator" && activeRoot.status === "waiting_human";
      if (mentions.length > 0 && (task.activeRunId || task.activeAgentTaskId)) {
        throw new Error("任务正在执行；请先中止或等待完成后再使用 @mention 分发");
      }
      if (mentions.length > 0 && task.stage === "completed") {
        throw new Error("已完成任务需先移回待规划列才能使用 @mention 分发");
      }

      const comment: TaskComment = Object.freeze({ id: this.#id(), taskId: task.id, author: "user", messageKind: "comment", body, createdAt: now });
      const activities: TaskActivity[] = [this.#activity(task.id, "comment", "用户添加了评论", body, now)];
      if (resumingCoordinator && activeRoot) {
        const review = this.#coordinatorReviewTask(current, task, activeRoot, now, body);
        const waitingRoot: AgentTask = Object.freeze({ ...activeRoot, status: "waiting_children", updatedAt: now });
        const queuedTask = applyTaskLifecycle(task, { type: "execution-queued" }, now);
        return {
          ...current,
          tasks: current.tasks.map((candidate) => candidate.id === task.id ? queuedTask : candidate),
          comments: [...current.comments, comment],
          agentTasks: [...current.agentTasks.map((candidate) => candidate.id === activeRoot.id ? waitingRoot : candidate), review],
          activities: [...current.activities, ...activities, this.#activity(task.id, "dispatch", "用户回复已交给 LEAD 继续决策", body, now, review.id)],
        };
      }
      if (mentions.length === 0) {
        return { ...current, comments: [...current.comments, comment], activities: [...current.activities, ...activities] };
      }

      const comments = [...current.comments.filter((candidate) => candidate.taskId === task.id), comment];
      const rootAgent = mentions[0];
      if (!rootAgent) throw new Error("mention 解析结果缺少根 Agent");
      const leadMention = mentions.find((agent) => agent.id === "lead");
      if (leadMention && rootAgent.id !== "lead") throw new Error("@lead 必须是消息中的第一个 Agent mention，由 LEAD 决定后续委派");
      const rootId = this.#id();
      const squadId = task.executionTarget.kind === "squad" ? task.executionTarget.squadId : undefined;
      const root: AgentTask = Object.freeze({
        id: rootId,
        taskId: task.id,
        agentSnapshot: cloneAgent(rootAgent),
        kind: rootAgent.id === "lead" ? "coordinator" : mentions.length > 1 ? "mention-root" : "direct",
        status: "queued",
        acceptance: "not-ready",
        prompt: rootAgent.id === "lead"
          ? this.#coordinatorPrompt(task, body, availableAgents, comments)
          : this.#promptFor(task, rootAgent, comments),
        squadId,
        createdAt: now,
        updatedAt: now,
      });
      const children = (rootAgent.id === "lead" ? [] : mentions.slice(1)).map((agent) => Object.freeze({
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
      const nextTask = applyTaskLifecycle(Object.freeze({ ...task, activeAgentTaskId: rootId }), { type: "execution-queued" }, now);
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
      const agent = this.#agent(current, task.executionTarget.agentId, task.projectPath);
      const agentTask = this.#rootAgentTask(
        task,
        agent,
        agent.id === "lead" ? "coordinator" : "direct",
        agent.id === "lead"
          ? this.#coordinatorPrompt(task, `请规划并推进任务「${task.title}」`, availableMentionAgentsForTask(task, this.#catalogFor(current), current.squads), current.comments.filter((comment) => comment.taskId === task.id))
          : this.#promptFor(task, agent, current.comments.filter((comment) => comment.taskId === task.id)),
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
      const leader = this.#agent(current, squad.leaderAgentId, task.projectPath);
      const members = squad.memberAgentIds.map((agentId) => this.#agent(current, agentId, task.projectPath));
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
        tasks: current.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(candidate, { type: "execution-started" }, now)
          : candidate),
        agentTasks: current.agentTasks.map((candidate) => candidate.id === next.id ? running : candidate),
        activities: [...current.activities, this.#activity(task.id, "agent", `${next.agentSnapshot.name}开始执行`, next.kind, now, next.id)],
      };
    });
    if (!claimed) return undefined;
    const bootstrap = Object.freeze({ board, catalog: this.#catalogFor(board) });
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
          ? applyTaskLifecycle(Object.freeze({ ...task, activeAgentTaskId: undefined }), { type: "execution-failed", reason: message }, now)
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
          ? applyTaskLifecycle(Object.freeze({
              ...task,
              activeAgentTaskId: undefined,
            }), { type: "execution-failed", reason: "子 AgentTask 未成功完成" }, now)
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
      const resultFields: AgentTaskResultFields = Object.freeze({
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

      if (agentTask.kind === "coordinator" || agentTask.kind === "coordinator-review") {
        const availableAgents = availableMentionAgentsForTask(task, this.#catalogFor(current), current.squads);
        const action = parseCoordinatorAction(output, availableAgents);
        const coordinatorComment: TaskComment = Object.freeze({ ...comment, body: coordinatorActionMessage(action) });
        return this.#applyCoordinatorAction(current, task, agentTask, resultFields, action, coordinatorComment, baseActivities, now);
      }

      if (agentTask.kind === "squad-leader") {
        const squad = this.#squad(current, agentTask.squadId ?? "");
        const members = squad.memberAgentIds.map((agentId) => this.#agent(current, agentId, task.projectPath));
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
            tasks: current.tasks.map((candidate) => candidate.id === task.id
              ? applyTaskLifecycle(candidate, { type: "execution-queued" }, now)
              : candidate),
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
          tasks: current.tasks.map((candidate) => candidate.id === task.id
            ? applyTaskLifecycle(candidate, { type: "execution-queued" }, now)
            : candidate),
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
        if (parent.kind === "coordinator") {
          const workers = current.agentTasks
            .filter((candidate) => candidate.parentAgentTaskId === parent.id && candidate.kind === "delegated")
            .map((candidate) => candidate.id === agentTask.id ? reported : candidate);
          const allReported = workers.length > 0 && workers.every((candidate) => candidate.status === "reported");
          const review = allReported ? this.#coordinatorReviewTask(current, task, parent, now, reported) : undefined;
          return {
            ...current,
            tasks: current.tasks.map((candidate) => candidate.id === task.id
              ? applyTaskLifecycle(candidate, { type: "execution-queued" }, now)
              : candidate),
            agentTasks: [
              ...current.agentTasks.map((candidate) => candidate.id === agentTask.id ? reported : candidate),
              ...(review ? [review] : []),
            ],
            comments: [...current.comments, comment],
            activities: review
              ? [...baseActivities, this.#activity(task.id, "dispatch", "成员报告已汇总，LEAD 进入验收回合", undefined, now, review.id)]
              : baseActivities,
          };
        }
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
            ? allReported
              ? applyTaskLifecycle(Object.freeze({ ...task, activeAgentTaskId: undefined }), { type: "execution-reported" }, now)
              : applyTaskLifecycle(task, { type: "execution-queued" }, now)
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
          ? applyTaskLifecycle(Object.freeze({ ...task, activeAgentTaskId: undefined }), { type: "execution-reported" }, now)
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
          ? applyTaskLifecycle(Object.freeze({ ...task, activeAgentTaskId: undefined }), { type: "execution-failed", reason: message }, now)
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
          ? applyTaskLifecycle(Object.freeze({
              ...task,
              activeAgentTaskId: undefined,
            }), { type: "execution-interrupted", reason: "用户中止 Agent 执行" }, now)
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
          ? applyTaskLifecycle(Object.freeze({ ...task, activeAgentTaskId: undefined }), { type: "execution-interrupted", reason }, now)
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
    kind: "direct" | "squad-leader" | "coordinator",
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
    const nextTask = applyTaskLifecycle(Object.freeze({ ...task, activeAgentTaskId: agentTask.id }), { type: "execution-queued" }, now);
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

  #agent(state: BoardState, agentId: string, projectPath: string): AgentDefinition {
    const agent = this.#catalogFor(state).agents.find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(`未知 Agent: ${agentId}`);
    const scoped = agent as AgentDefinition & { readonly projectPath?: string };
    if (scoped.projectPath && scoped.projectPath !== projectPath) throw new Error(`Agent ${agent.id} 属于其他项目`);
    return agent;
  }

  #catalogFor(state: BoardState): OrchestrationCatalog {
    return catalogForBoard(this.#catalog, state);
  }

  #applyCoordinatorAction(
    state: BoardState,
    task: KanbanTask,
    attempt: AgentTask,
    resultFields: AgentTaskResultFields,
    action: CoordinatorAction,
    comment: TaskComment,
    activities: readonly TaskActivity[],
    now: string,
  ): BoardState {
    const root = attempt.kind === "coordinator" ? attempt : this.#agentTask(state, attempt.parentAgentTaskId ?? "");
    if (root.kind !== "coordinator") throw new Error(`Coordinator review ${attempt.id} 的父任务不是 Coordinator`);
    const completedAttempt: AgentTask | undefined = attempt.id === root.id ? undefined : Object.freeze({
      ...attempt,
      ...resultFields,
      status: "reported",
      acceptance: "not-ready",
      completedAt: now,
    });
    const resultOnRoot = attempt.id === root.id
      ? resultFields
      : Object.freeze({ output: resultFields.output, updatedAt: now });

    if (action.action === "delegate" || action.action === "request_revision" || action.action === "replan") {
      const children = action.delegations.map((delegation) => this.#coordinatorDelegatedTask(state, task, root, action, delegation, now));
      const waitingRoot: AgentTask = Object.freeze({
        ...root,
        ...resultOnRoot,
        runtimeToken: undefined,
        status: "waiting_children",
        acceptance: "not-ready",
        completedAt: undefined,
      });
      return {
        ...state,
        tasks: state.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(Object.freeze({ ...candidate, activeAgentTaskId: root.id }), { type: "execution-queued" }, now)
          : candidate),
        agentTasks: [
          ...state.agentTasks.map((candidate) => {
            if (candidate.id === root.id) return waitingRoot;
            if (completedAttempt && candidate.id === completedAttempt.id) return completedAttempt;
            return candidate;
          }),
          ...children,
        ],
        comments: [...state.comments, comment],
        activities: [...activities, this.#activity(task.id, "dispatch", `LEAD ${action.action === "request_revision" ? "要求修订" : action.action === "replan" ? "重新规划并委派" : "完成委派"}`, action.delegations.map((item) => `@${item.agentId}`).join("、"), now, root.id)],
      };
    }

    if (action.action === "ask_human") {
      const waitingRoot: AgentTask = Object.freeze({
        ...root,
        ...resultOnRoot,
        runtimeToken: undefined,
        status: "waiting_human",
        acceptance: "not-ready",
        completedAt: undefined,
      });
      return {
        ...state,
        tasks: state.tasks.map((candidate) => candidate.id === task.id
          ? applyTaskLifecycle(Object.freeze({ ...candidate, activeAgentTaskId: root.id }), { type: "awaiting-human" }, now)
          : candidate),
        agentTasks: state.agentTasks.map((candidate) => {
          if (candidate.id === root.id) return waitingRoot;
          if (completedAttempt && candidate.id === completedAttempt.id) return completedAttempt;
          return candidate;
        }),
        comments: [...state.comments, comment],
        activities: [...activities, this.#activity(task.id, "gate", "LEAD 请求用户决定", action.question, now, root.id)],
      };
    }

    const reportedRoot: AgentTask = Object.freeze({
      ...root,
      ...resultOnRoot,
      runtimeToken: undefined,
      status: "reported",
      acceptance: "pending",
      completedAt: now,
    });
    return {
      ...state,
      tasks: state.tasks.map((candidate) => candidate.id === task.id
        ? applyTaskLifecycle(Object.freeze({ ...candidate, activeAgentTaskId: undefined }), { type: "execution-reported" }, now)
        : candidate),
      agentTasks: state.agentTasks.map((candidate) => {
        if (candidate.id === root.id) return reportedRoot;
        if (completedAttempt && candidate.id === completedAttempt.id) return completedAttempt;
        return candidate;
      }),
      comments: [...state.comments, comment],
      activities: [...activities, this.#activity(task.id, "status", "LEAD 已完成团队验收，等待用户接受报告", action.summary, now, root.id)],
    };
  }

  #coordinatorDelegatedTask(
    state: BoardState,
    task: KanbanTask,
    root: AgentTask,
    action: CoordinatorAction,
    delegation: CoordinatorDelegation,
    now: string,
  ): AgentTask {
    const agent = this.#agent(state, delegation.agentId, task.projectPath);
    return Object.freeze({
      id: this.#id(),
      taskId: task.id,
      agentSnapshot: cloneAgent(agent),
      kind: "delegated",
      status: "queued",
      acceptance: "not-ready",
      prompt: this.#coordinatorDelegatedPrompt(task, agent, action, delegation),
      parentAgentTaskId: root.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  #coordinatorReviewTask(
    state: BoardState,
    task: KanbanTask,
    root: AgentTask,
    now: string,
    extraReport?: AgentTask | string,
  ): AgentTask {
    return Object.freeze({
      id: this.#id(),
      taskId: task.id,
      agentSnapshot: cloneAgent(root.agentSnapshot),
      kind: "coordinator-review",
      status: "queued",
      acceptance: "not-ready",
      prompt: this.#coordinatorReviewPrompt(state, task, root, extraReport),
      parentAgentTaskId: root.id,
      createdAt: now,
      updatedAt: now,
    });
  }

  #promptFor(task: KanbanTask, agent: AgentDefinition, comments: readonly TaskComment[]): string {
    const discussion = comments.map((comment) => `- ${comment.author === "user" ? "用户" : comment.authorAgentId ?? comment.author}：${comment.body}`).join("\n");
    return [
      "# Stella 单 Agent 任务", "", `项目：${task.projectName}`, `任务：${task.title}`,
      `执行角色：${agent.name}（@${agent.id} / ${agent.callsign}）`, "", "## 任务说明",
      task.description || "（未提供补充说明）", "", "## 验收标准",
      task.acceptanceCriteria || "（未提供补充标准，请以任务目标和项目约束为准）", "", "## 任务讨论",
      discussion || "（暂无评论）", "", "## 角色固定指令", agent.instructions,
      "", "只完成当前角色职责。必须真实操作并验证；最终回复是一份独立结果，明确写出失败和未验证项。",
    ].join("\n");
  }

  #coordinatorPrompt(
    task: KanbanTask,
    request: string,
    availableAgents: readonly AgentDefinition[],
    comments: readonly TaskComment[],
  ): string {
    const workers = availableAgents.filter((agent) => agent.id !== "lead").map((agent) => `- ${agent.id} / @${agent.callsign}：${agent.responsibility}；workspace=${agent.workspaceAccess}`).join("\n");
    const discussion = comments.map((comment) => `- ${comment.author === "user" ? "用户" : comment.authorAgentId ?? comment.author}：${comment.body}`).join("\n");
    return [
      "# Stella Coordinator 回合", "", `任务：${task.title}`, `用户请求：${request}`,
      "", "## 任务说明", task.description || "（未提供补充说明）",
      "", "## 验收标准", task.acceptanceCriteria || "（未提供补充标准）",
      "", "## Task Room", discussion || "（暂无其他消息）",
      "", "## 可委派 Agent", workers || "（没有可委派 Agent；只能 complete 或 ask_human）",
      "", "## 严格行动协议",
      "最终回复只能是一个 JSON 对象，不能使用 Markdown 代码块、前后说明或 @mention。允许字段只有 action、summary、delegations、question。",
      "action 必须是 delegate、request_revision、replan、complete、ask_human 之一。",
      "delegate/request_revision/replan 必须提供非空 delegations；每项精确包含 agentId、objective、acceptanceCriteria。",
      "ask_human 必须提供 question 且 delegations 为空。complete 的 delegations 必须为空。",
      '{"action":"delegate","summary":"为什么这样拆分","delegations":[{"agentId":"scout","objective":"真实工作目标","acceptanceCriteria":"可验证结果"}]}',
      "你只提出结构化行动。Stella 在验证 JSON 后才会创建真实 AgentTask；不得声称尚未返回报告的 Agent 已完成工作。",
    ].join("\n");
  }

  #coordinatorReviewPrompt(
    state: BoardState,
    task: KanbanTask,
    root: AgentTask,
    extraReport?: AgentTask | string,
  ): string {
    const reportOverride = typeof extraReport === "string" ? undefined : extraReport;
    const reports = state.agentTasks
      .filter((candidate) => candidate.parentAgentTaskId === root.id && candidate.kind === "delegated")
      .map((candidate) => candidate.id === reportOverride?.id ? reportOverride : candidate)
      .filter((candidate) => candidate.output)
      .map((candidate) => `### ${candidate.agentSnapshot.name} (@${candidate.agentSnapshot.id})\n${candidate.output}`);
    const reply = typeof extraReport === "string" ? extraReport : undefined;
    const discussion = state.comments.filter((comment) => comment.taskId === task.id).map((comment) => `- ${comment.author === "user" ? "用户" : comment.authorAgentId ?? comment.author}：${comment.body}`).join("\n");
    return [
      "# Stella Coordinator 验收回合", "", `任务：${task.title}`,
      "", "## 任务验收标准", task.acceptanceCriteria || "（未提供补充标准）",
      "", "## 成员真实报告", reports.join("\n\n") || "（本回合没有成员报告）",
      ...(reply ? ["", "## 用户刚刚的回复", reply] : []),
      "", "## Task Room", discussion || "（暂无消息）",
      "", "核对报告是否满足验收标准。信息充分时 complete；需要成员补做时 request_revision；任务拆解需要变化时 replan；缺少用户决定时 ask_human。",
      "最终回复只能是严格 JSON，字段和约束与上一 Coordinator 回合完全相同；不能使用 Markdown 代码块、自然语言前后缀或 @mention。",
      '{"action":"complete","summary":"基于哪些报告判定满足验收","delegations":[]}',
    ].join("\n");
  }

  #coordinatorDelegatedPrompt(
    task: KanbanTask,
    agent: AgentDefinition,
    action: CoordinatorAction,
    delegation: CoordinatorDelegation,
  ): string {
    return [
      "# Stella Coordinator 委派", "", `任务：${task.title}`, `执行角色：${agent.name}（@${agent.id}）`,
      "", "## LEAD 决策", action.summary,
      "", "## 你的目标", delegation.objective,
      "", "## 本次委派验收标准", delegation.acceptanceCriteria,
      "", "## 任务总体验收标准", task.acceptanceCriteria || "（未提供补充标准）",
      "", "## 角色固定指令", agent.instructions,
      "", "只执行本次委派。必须真实操作并验证；最终报告明确列出结果、证据、失败和未验证项。不要在输出中 @mention 其他 Agent。",
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
      "", "## Leader 角色固定指令", leader.instructions,
      "", "先完成 Leader 的分析或工作。若确实需要成员继续执行，只在最终回复中使用上述精确别名 @mention；Stella 会为每个被提及成员创建真实子 AgentTask。不要声称成员已经执行。未提及任何成员表示无需委派。",
    ].join("\n");
  }

  #delegatedPrompt(task: KanbanTask, squad: Squad, agent: AgentDefinition, leaderOutput: string): string {
    return [
      "# Stella Squad 子任务", "", `Squad：${squad.name}`, `任务：${task.title}`, `执行成员：${agent.name}（@${agent.id}）`,
      "", "## 任务说明", task.description || "（未提供补充说明）", "", "## 验收标准",
      task.acceptanceCriteria || "（未提供补充标准）", "", "## Leader 产物与委派上下文", leaderOutput,
      "", "## 成员角色固定指令", agent.instructions,
      "", "只执行你的成员职责。真实操作并验证，最终明确报告结果、失败和未验证项。",
    ].join("\n");
  }

  #mentionPrompt(task: KanbanTask, agent: AgentDefinition, comment: string): string {
    return [
      "# Stella @mention 委派任务", "", `任务：${task.title}`, `执行角色：${agent.name}（@${agent.id}）`,
      "", "## 用户委派评论", comment, "", "## 任务说明", task.description || "（未提供补充说明）",
      "", "## 验收标准", task.acceptanceCriteria || "（未提供补充标准）",
      "", "## 角色固定指令", agent.instructions,
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
    const bootstrap = Object.freeze({ board, catalog: this.#catalogFor(board) });
    this.#emitChanged(bootstrap);
    return bootstrap;
  }
}

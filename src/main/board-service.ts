import { randomUUID } from "node:crypto";
import type { BoardRepository } from "./board-repository";
import {
  AGENT_THINKING_LEVELS,
  TASK_PRIORITIES,
  canMoveTaskManually,
  type BoardBootstrap,
  type BoardState,
  type CreateProjectAgentInput,
  type CreateTaskInput,
  type ExecutionTarget,
  type KanbanTask,
  type ManualTaskStage,
  type OrchestrationCatalog,
  type ProjectAgentDefinition,
  type TaskActivity,
  type UpdateProjectAgentInput,
  type UpdateTaskInput,
} from "../shared/kanban";
import { catalogForBoard } from "../shared/orchestration-catalog";

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
    const board = await this.#repository.read();
    return Object.freeze({ board, catalog: catalogForBoard(this.#catalog, board) });
  }

  async createTask(input: CreateTaskInput): Promise<BoardBootstrap> {
    if (!TASK_PRIORITIES.includes(input.priority)) throw new Error(`无效优先级: ${String(input.priority)}`);
    const now = this.#now();
    return this.#commit((current) => {
      this.#assertExecutionTarget(current, input.executionTarget, input.projectPath);
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
      this.#assertExecutionTarget(current, input.executionTarget, task.projectPath);
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

  async createProjectAgent(input: CreateProjectAgentInput): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const definition = this.#validatedProjectAgent(input, now);
      if (this.#catalogFor(current).agents.some((agent) => agent.id === definition.id || agent.callsign.toLocaleLowerCase() === definition.callsign.toLocaleLowerCase())) {
        throw new Error(`Agent ID 或呼号已存在: @${definition.callsign}`);
      }
      return { ...current, customAgents: [...current.customAgents, definition] };
    });
  }

  async updateProjectAgent(input: UpdateProjectAgentInput): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const existing = current.customAgents.find((agent) => agent.id === input.agentId);
      if (!existing) throw new Error(`找不到自定义 Agent: ${input.agentId}`);
      if (existing.projectPath !== input.projectPath) throw new Error("自定义 Agent 不能跨项目迁移");
      const draft = this.#validatedProjectAgent(input, now, existing);
      const duplicate = this.#catalogFor(current).agents.find((agent) => agent.id !== existing.id && agent.callsign.toLocaleLowerCase() === draft.callsign.toLocaleLowerCase());
      if (duplicate) throw new Error(`Agent 呼号已存在: @${draft.callsign}`);
      const updated: ProjectAgentDefinition = Object.freeze({ ...draft, id: existing.id, version: existing.version + 1, createdAt: existing.createdAt });
      return { ...current, customAgents: current.customAgents.map((agent) => agent.id === existing.id ? updated : agent) };
    });
  }

  async deleteProjectAgent(agentId: string): Promise<BoardBootstrap> {
    return this.#commit((current) => {
      const agent = current.customAgents.find((candidate) => candidate.id === agentId);
      if (!agent) throw new Error(`找不到自定义 Agent: ${agentId}`);
      if (current.tasks.some((task) => task.executionTarget.kind === "agent" && task.executionTarget.agentId === agent.id)) throw new Error("仍有任务引用该 Agent，不能删除");
      if (current.squads.some((squad) => squad.leaderAgentId === agent.id || squad.memberAgentIds.includes(agent.id))) throw new Error("仍有 Squad 引用该 Agent，不能删除");
      if (current.autopilots.some((autopilot) => autopilot.executionTarget.kind === "agent" && autopilot.executionTarget.agentId === agent.id)) throw new Error("仍有 Autopilot 引用该 Agent，不能删除");
      return { ...current, customAgents: current.customAgents.filter((candidate) => candidate.id !== agent.id) };
    });
  }

  #task(state: BoardState, taskId: string): KanbanTask {
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`找不到任务: ${taskId}`);
    return task;
  }

  #assertExecutionTarget(state: BoardState, target: ExecutionTarget, projectPath: string): void {
    const catalog = this.#catalogFor(state);
    if (target.kind === "workflow" && !this.#catalog.workflows.some((workflow) => workflow.id === target.workflowId)) {
      throw new Error(`未知流程模板: ${target.workflowId}`);
    }
    if (target.kind === "agent") {
      const agent = catalog.agents.find((candidate) => candidate.id === target.agentId);
      if (!agent) throw new Error(`未知 Agent: ${target.agentId}`);
      const scoped = agent as Partial<ProjectAgentDefinition>;
      if (scoped.projectPath && scoped.projectPath !== projectPath) throw new Error(`Agent ${agent.id} 属于其他项目`);
    }
    if (target.kind === "squad") {
      const squad = state.squads.find((candidate) => candidate.id === target.squadId);
      if (!squad) throw new Error(`未知 Squad: ${target.squadId}`);
      const scopedAgents = [squad.leaderAgentId, ...squad.memberAgentIds]
        .map((agentId) => catalog.agents.find((agent) => agent.id === agentId) as Partial<ProjectAgentDefinition> | undefined)
        .filter((agent): agent is Partial<ProjectAgentDefinition> => Boolean(agent?.projectPath));
      if (scopedAgents.some((agent) => agent.projectPath !== projectPath)) throw new Error(`Squad ${squad.id} 包含其他项目的自定义 Agent`);
    }
  }

  #validatedProjectAgent(input: CreateProjectAgentInput, now: string, existing?: ProjectAgentDefinition): ProjectAgentDefinition {
    const callsign = normalizedText(input.callsign, "Agent 呼号", true).toLocaleUpperCase();
    if (!/^[A-Z0-9_-]+$/u.test(callsign)) throw new Error("Agent 呼号只能包含英文字母、数字、下划线或连字符");
    const workspaceAccess = input.workspaceAccess;
    if (workspaceAccess !== "read" && workspaceAccess !== "write") throw new Error(`无效 workspaceAccess: ${String(workspaceAccess)}`);
    const allowedToolSet = new Set(["read", "grep", "find", "ls", "bash", "edit", "write"]);
    const allowedTools = Object.freeze([...new Set(input.allowedTools.map((tool) => normalizedText(tool, "Agent 工具", true)))]);
    if (allowedTools.length === 0 || allowedTools.some((tool) => !allowedToolSet.has(tool))) throw new Error("Agent 工具列表包含空值或不支持的工具");
    if (workspaceAccess === "read" && allowedTools.some((tool) => tool === "bash" || tool === "edit" || tool === "write")) {
      throw new Error("只读 Agent 不能启用 bash、edit 或 write");
    }
    if (!AGENT_THINKING_LEVELS.includes(input.thinking)) throw new Error(`无效 thinking level: ${String(input.thinking)}`);
    const requiredSkills = input.requiredSkills?.map((skill) => normalizedText(skill, "Required Skill", true));
    const id = existing?.id ?? `custom-${callsign.toLocaleLowerCase()}`;
    return Object.freeze({
      id,
      version: existing?.version ?? 1,
      name: normalizedText(input.name, "Agent 名称", true),
      callsign,
      responsibility: normalizedText(input.responsibility, "Agent 职责", true),
      instructions: normalizedText(input.instructions, "Agent 指令", true),
      workspaceAccess,
      allowedTools,
      requiredSkills: requiredSkills?.length ? Object.freeze([...new Set(requiredSkills)]) : undefined,
      thinking: input.thinking,
      provider: input.provider?.trim() || undefined,
      model: input.model?.trim() || undefined,
      disableExtensions: input.disableExtensions,
      disableSkills: input.disableSkills,
      disablePromptTemplates: input.disablePromptTemplates,
      projectPath: normalizedText(input.projectPath, "项目路径", true),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  #catalogFor(state: BoardState): OrchestrationCatalog {
    return catalogForBoard(this.#catalog, state);
  }

  #activity(taskId: string, kind: TaskActivity["kind"], summary: string, detail: string | undefined, now: string): TaskActivity {
    return Object.freeze({ id: this.#id(), taskId, kind, summary, detail, createdAt: now });
  }

  async #commit(transform: (current: BoardState) => BoardState): Promise<BoardBootstrap> {
    const board = await this.#repository.update(transform);
    const bootstrap = Object.freeze({ board, catalog: this.#catalogFor(board) });
    this.#emitChanged(bootstrap);
    return bootstrap;
  }
}

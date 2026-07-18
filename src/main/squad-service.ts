import { randomUUID } from "node:crypto";
import type { BoardRepository } from "./board-repository";
import type {
  BoardBootstrap,
  BoardState,
  CreateSquadInput,
  OrchestrationCatalog,
  ProjectAgentDefinition,
  Squad,
  UpdateSquadInput,
} from "../shared/kanban";
import { catalogForBoard } from "../shared/orchestration-catalog";

interface SquadServiceDependencies {
  readonly repository: BoardRepository;
  readonly catalog: OrchestrationCatalog;
  readonly emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly now?: () => string;
  readonly id?: () => string;
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空`);
  return normalized;
}

export class SquadService {
  readonly #repository: BoardRepository;
  readonly #catalog: OrchestrationCatalog;
  readonly #emitChanged: (bootstrap: BoardBootstrap) => void;
  readonly #now: () => string;
  readonly #id: () => string;

  constructor(dependencies: SquadServiceDependencies) {
    this.#repository = dependencies.repository;
    this.#catalog = dependencies.catalog;
    this.#emitChanged = dependencies.emitChanged;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
    this.#id = dependencies.id ?? randomUUID;
  }

  async create(input: CreateSquadInput): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const normalized = this.#validatedInput(current, input);
      if (current.squads.some((squad) => squad.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase())) {
        throw new Error(`Squad 名称已存在: ${normalized.name}`);
      }
      const squad: Squad = Object.freeze({ id: this.#id(), ...normalized, createdAt: now, updatedAt: now });
      return { ...current, squads: [...current.squads, squad] };
    });
  }

  async update(input: UpdateSquadInput): Promise<BoardBootstrap> {
    const now = this.#now();
    return this.#commit((current) => {
      const existing = this.#squad(current, input.squadId);
      const normalized = this.#validatedInput(current, input);
      if (current.squads.some((squad) => squad.id !== existing.id && squad.name.toLocaleLowerCase() === normalized.name.toLocaleLowerCase())) {
        throw new Error(`Squad 名称已存在: ${normalized.name}`);
      }
      const squad: Squad = Object.freeze({ ...existing, ...normalized, updatedAt: now });
      return { ...current, squads: current.squads.map((candidate) => candidate.id === squad.id ? squad : candidate) };
    });
  }

  async delete(squadId: string): Promise<BoardBootstrap> {
    return this.#commit((current) => {
      const squad = this.#squad(current, squadId);
      if (current.tasks.some((task) => task.executionTarget.kind === "squad" && task.executionTarget.squadId === squad.id)) {
        throw new Error("仍有任务引用该 Squad，不能删除");
      }
      if (current.autopilots.some((autopilot) => autopilot.executionTarget.kind === "squad" && autopilot.executionTarget.squadId === squad.id)) {
        throw new Error("仍有 Autopilot 引用该 Squad，不能删除");
      }
      if (current.agentTasks.some((agentTask) => agentTask.squadId === squad.id)) {
        throw new Error("该 Squad 已有执行历史，不能删除");
      }
      return { ...current, squads: current.squads.filter((candidate) => candidate.id !== squad.id) };
    });
  }

  #validatedInput(state: BoardState, input: CreateSquadInput): Omit<Squad, "id" | "createdAt" | "updatedAt"> {
    const leaderAgentId = required(input.leaderAgentId, "Leader Agent");
    if (leaderAgentId === "lead") throw new Error("通用 LEAD 使用 Coordinator 协议；请在 Task Room 中 @lead，不要把它配置为旧式 Squad Leader");
    this.#agent(state, leaderAgentId);
    const memberAgentIds = Object.freeze(input.memberAgentIds.map((agentId) => required(agentId, "成员 Agent")));
    if (memberAgentIds.length === 0) throw new Error("Squad 至少需要一位成员");
    if (new Set(memberAgentIds).size !== memberAgentIds.length) throw new Error("Squad 成员不能重复");
    if (memberAgentIds.includes(leaderAgentId)) throw new Error("Leader 不能重复出现在 Squad 成员中");
    if (memberAgentIds.includes("lead")) throw new Error("通用 LEAD 不能作为旧式 Squad 成员");
    memberAgentIds.forEach((agentId) => this.#agent(state, agentId));
    const catalog = catalogForBoard(this.#catalog, state);
    const projectPaths = new Set([leaderAgentId, ...memberAgentIds]
      .map((agentId) => catalog.agents.find((agent) => agent.id === agentId) as Partial<ProjectAgentDefinition> | undefined)
      .map((agent) => agent?.projectPath)
      .filter((path): path is string => Boolean(path)));
    if (projectPaths.size > 1) throw new Error("Squad 不能混用不同项目的自定义 Agent");
    return Object.freeze({
      name: required(input.name, "Squad 名称"),
      description: input.description.trim(),
      leaderAgentId,
      memberAgentIds,
      leaderInstructions: required(input.leaderInstructions, "Leader 指令"),
    });
  }

  #agent(state: BoardState, agentId: string): void {
    if (!catalogForBoard(this.#catalog, state).agents.some((agent) => agent.id === agentId)) throw new Error(`未知 Agent: ${agentId}`);
  }

  #squad(state: BoardState, squadId: string): Squad {
    const squad = state.squads.find((candidate) => candidate.id === squadId);
    if (!squad) throw new Error(`找不到 Squad: ${squadId}`);
    return squad;
  }

  async #commit(transform: (current: BoardState) => BoardState): Promise<BoardBootstrap> {
    const board = await this.#repository.update(transform);
    const bootstrap = Object.freeze({ board, catalog: catalogForBoard(this.#catalog, board) });
    this.#emitChanged(bootstrap);
    return bootstrap;
  }
}

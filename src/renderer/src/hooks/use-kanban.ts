import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { CapabilityState } from "@shared/capabilities";
import type { BridgeEvent, StellaDesktopApi } from "@shared/contracts";
import type {
  BoardBootstrap,
  BoardBridgeEvent,
  CreateAutopilotInput,
  CreateProjectAgentInput,
  CreateTaskInput,
  CreateTaskCommentInput,
  LaunchTeamTaskInput,
  CreateSquadInput,
  ManualTaskStage,
  ReviewExecutionInput,
  ResolveGateInput,
  UpdateTaskInput,
  UpdateAutopilotInput,
  UpdateProjectAgentInput,
  UpdateSquadInput,
} from "@shared/kanban";

interface KanbanUiState {
  readonly phase: "loading" | "ready" | "error";
  readonly bootstrap?: BoardBootstrap;
  readonly error?: string;
  readonly pending: readonly string[];
  readonly liveEvents: Readonly<Record<string, Extract<BoardBridgeEvent, { type: "agent-event" }>>>;
  readonly liveAgentTaskEvents: Readonly<Record<string, Extract<BoardBridgeEvent, { type: "agent-task-event" }>>>;
  readonly automationRuntime?: Extract<BoardBridgeEvent, { type: "automation-runtime" }>["status"];
}

type KanbanAction =
  | { readonly type: "BOOTSTRAP"; readonly bootstrap: BoardBootstrap }
  | { readonly type: "FAILED"; readonly error: string }
  | { readonly type: "PENDING"; readonly key: string; readonly active: boolean }
  | { readonly type: "EVENT"; readonly event: Extract<BoardBridgeEvent, { type: "agent-event" }> }
  | { readonly type: "AGENT_TASK_EVENT"; readonly event: Extract<BoardBridgeEvent, { type: "agent-task-event" }> }
  | { readonly type: "AUTOMATION_RUNTIME"; readonly status: Extract<BoardBridgeEvent, { type: "automation-runtime" }>["status"] };

const INITIAL_STATE: KanbanUiState = Object.freeze({
  phase: "loading",
  pending: Object.freeze([]),
  liveEvents: Object.freeze({}),
  liveAgentTaskEvents: Object.freeze({}),
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reducer(state: KanbanUiState, action: KanbanAction): KanbanUiState {
  if (action.type === "BOOTSTRAP") {
    const runIds = new Set(action.bootstrap.board.runs.map((run) => run.id));
    const liveEvents = Object.freeze(Object.fromEntries(
      Object.entries(state.liveEvents).filter(([runId]) => runIds.has(runId)),
    ));
    const agentTaskIds = new Set(action.bootstrap.board.agentTasks.map((agentTask) => agentTask.id));
    const liveAgentTaskEvents = Object.freeze(Object.fromEntries(
      Object.entries(state.liveAgentTaskEvents).filter(([agentTaskId]) => agentTaskIds.has(agentTaskId)),
    ));
    return { ...state, phase: "ready", bootstrap: action.bootstrap, error: undefined, liveEvents, liveAgentTaskEvents };
  }
  if (action.type === "FAILED") return { ...state, phase: state.bootstrap ? "ready" : "error", error: action.error };
  if (action.type === "PENDING") {
    const pending = action.active
      ? state.pending.includes(action.key) ? state.pending : [...state.pending, action.key]
      : state.pending.filter((key) => key !== action.key);
    return { ...state, pending: Object.freeze(pending) };
  }
  if (action.type === "EVENT") {
    return {
      ...state,
      liveEvents: Object.freeze({ ...state.liveEvents, [action.event.runId]: action.event }),
    };
  }
  if (action.type === "AGENT_TASK_EVENT") {
    return {
      ...state,
      liveAgentTaskEvents: Object.freeze({ ...state.liveAgentTaskEvents, [action.event.agentTaskId]: action.event }),
    };
  }
  if (action.type === "AUTOMATION_RUNTIME") return { ...state, automationRuntime: action.status };
  return state;
}

export interface KanbanController {
  readonly state: KanbanUiState;
  createTask(input: CreateTaskInput): Promise<BoardBootstrap>;
  launchTeamTask(input: LaunchTeamTaskInput): Promise<BoardBootstrap>;
  updateTask(input: UpdateTaskInput): Promise<BoardBootstrap>;
  moveTask(taskId: string, stage: ManualTaskStage): Promise<BoardBootstrap>;
  deleteTask(taskId: string): Promise<BoardBootstrap>;
  addComment(input: CreateTaskCommentInput): Promise<BoardBootstrap>;
  createAgent(input: CreateProjectAgentInput): Promise<BoardBootstrap>;
  updateAgent(input: UpdateProjectAgentInput): Promise<BoardBootstrap>;
  deleteAgent(agentId: string): Promise<BoardBootstrap>;
  createSquad(input: CreateSquadInput): Promise<BoardBootstrap>;
  updateSquad(input: UpdateSquadInput): Promise<BoardBootstrap>;
  deleteSquad(squadId: string): Promise<BoardBootstrap>;
  createAutopilot(input: CreateAutopilotInput): Promise<BoardBootstrap>;
  updateAutopilot(input: UpdateAutopilotInput): Promise<BoardBootstrap>;
  deleteAutopilot(autopilotId: string): Promise<BoardBootstrap>;
  triggerAutopilot(autopilotId: string): Promise<BoardBootstrap>;
  dispatchTask(taskId: string): Promise<BoardBootstrap>;
  resolveGate(input: ResolveGateInput): Promise<BoardBootstrap>;
  reviewExecution(input: ReviewExecutionInput): Promise<BoardBootstrap>;
  abortTask(taskId: string): Promise<BoardBootstrap>;
}

export function useKanban(api: StellaDesktopApi): KanbanController {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const taskCapabilityState = useRef<CapabilityState | undefined>(undefined);
  const bootstrapEpoch = useRef(0);

  useEffect(() => {
    let active = true;
    const initialize = () => {
      const epoch = bootstrapEpoch.current;
      void api.boardInitialize()
        .then((bootstrap) => {
          // 若等待期间已应用更新的快照，丢弃过期的 initialize 结果，避免状态回滚。
          if (active && bootstrapEpoch.current === epoch) dispatch({ type: "BOOTSTRAP", bootstrap });
        })
        .catch((error: unknown) => { if (active) dispatch({ type: "FAILED", error: errorMessage(error) }); });
    };
    const unsubscribe = api.onEvent((event: BridgeEvent) => {
      if (!active) return;
      if (event.source === "capability") {
        const previous = taskCapabilityState.current;
        const next = event.payload.snapshot.task.state;
        taskCapabilityState.current = next;
        if (next !== "ready" || previous === "ready") return;
        initialize();
        return;
      }
      if (event.source !== "board") return;
      if (event.payload.type === "snapshot") {
        bootstrapEpoch.current += 1;
        dispatch({ type: "BOOTSTRAP", bootstrap: event.payload.bootstrap });
      }
      else if (event.payload.type === "agent-event") dispatch({ type: "EVENT", event: event.payload });
      else if (event.payload.type === "agent-task-event") dispatch({ type: "AGENT_TASK_EVENT", event: event.payload });
      else if (event.payload.type === "automation-runtime") dispatch({ type: "AUTOMATION_RUNTIME", status: event.payload.status });
      else if (event.payload.type === "automation-error") dispatch({ type: "FAILED", error: event.payload.message });
    });
    initialize();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const perform = useCallback(async (key: string, operation: () => Promise<BoardBootstrap>) => {
    dispatch({ type: "PENDING", key, active: true });
    try {
      const bootstrap = await operation();
      bootstrapEpoch.current += 1;
      dispatch({ type: "BOOTSTRAP", bootstrap });
      return bootstrap;
    } catch (error) {
      dispatch({ type: "FAILED", error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: "PENDING", key, active: false });
    }
  }, []);

  const createTask = useCallback((input: CreateTaskInput) => perform("create", () => api.boardCreateTask(input)), [api, perform]);
  const launchTeamTask = useCallback((input: LaunchTeamTaskInput) => perform("team:launch", () => api.boardLaunchTeamTask(input)), [api, perform]);
  const updateTask = useCallback((input: UpdateTaskInput) => perform(input.taskId, () => api.boardUpdateTask(input)), [api, perform]);
  const moveTask = useCallback((taskId: string, stage: ManualTaskStage) => perform(taskId, () => api.boardMoveTask(taskId, stage)), [api, perform]);
  const deleteTask = useCallback((taskId: string) => perform(taskId, () => api.boardDeleteTask(taskId)), [api, perform]);
  const addComment = useCallback((input: CreateTaskCommentInput) => perform(input.taskId, () => api.boardAddComment(input)), [api, perform]);
  const createAgent = useCallback((input: CreateProjectAgentInput) => perform("agent:create", () => api.boardCreateAgent(input)), [api, perform]);
  const updateAgent = useCallback((input: UpdateProjectAgentInput) => perform(`agent:${input.agentId}`, () => api.boardUpdateAgent(input)), [api, perform]);
  const deleteAgent = useCallback((agentId: string) => perform(`agent:${agentId}`, () => api.boardDeleteAgent(agentId)), [api, perform]);
  const createSquad = useCallback((input: CreateSquadInput) => perform("squad:create", () => api.boardCreateSquad(input)), [api, perform]);
  const updateSquad = useCallback((input: UpdateSquadInput) => perform(`squad:${input.squadId}`, () => api.boardUpdateSquad(input)), [api, perform]);
  const deleteSquad = useCallback((squadId: string) => perform(`squad:${squadId}`, () => api.boardDeleteSquad(squadId)), [api, perform]);
  const createAutopilot = useCallback((input: CreateAutopilotInput) => perform("autopilot:create", () => api.boardCreateAutopilot(input)), [api, perform]);
  const updateAutopilot = useCallback((input: UpdateAutopilotInput) => perform(`autopilot:${input.autopilotId}`, () => api.boardUpdateAutopilot(input)), [api, perform]);
  const deleteAutopilot = useCallback((autopilotId: string) => perform(`autopilot:${autopilotId}`, () => api.boardDeleteAutopilot(autopilotId)), [api, perform]);
  const triggerAutopilot = useCallback((autopilotId: string) => perform(`autopilot:${autopilotId}:trigger`, () => api.boardTriggerAutopilot(autopilotId)), [api, perform]);
  const dispatchTask = useCallback((taskId: string) => perform(taskId, () => api.boardDispatchTask(taskId)), [api, perform]);
  const resolveGate = useCallback((input: ResolveGateInput) => perform(input.taskId, () => api.boardResolveGate(input)), [api, perform]);
  const reviewExecution = useCallback((input: ReviewExecutionInput) => perform(input.taskId, () => api.boardReviewExecution(input)), [api, perform]);
  const abortTask = useCallback((taskId: string) => perform(taskId, () => api.boardAbortTask(taskId)), [api, perform]);

  return useMemo(() => ({
    state,
    createTask,
    launchTeamTask,
    updateTask,
    moveTask,
    deleteTask,
    addComment,
    createAgent,
    updateAgent,
    deleteAgent,
    createSquad,
    updateSquad,
    deleteSquad,
    createAutopilot,
    updateAutopilot,
    deleteAutopilot,
    triggerAutopilot,
    dispatchTask,
    resolveGate,
    reviewExecution,
    abortTask,
  }), [abortTask, addComment, createAgent, createAutopilot, createSquad, createTask, deleteAgent, deleteAutopilot, deleteSquad, deleteTask, dispatchTask, launchTeamTask, moveTask, resolveGate, reviewExecution, state, triggerAutopilot, updateAgent, updateAutopilot, updateSquad, updateTask]);
}

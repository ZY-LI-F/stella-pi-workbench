import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { BridgeEvent, StellaDesktopApi } from "@shared/contracts";
import type {
  BoardBootstrap,
  BoardBridgeEvent,
  CreateAutopilotInput,
  CreateTaskInput,
  CreateTaskCommentInput,
  CreateSquadInput,
  ManualTaskStatus,
  ResolveGateInput,
  UpdateTaskInput,
  UpdateAutopilotInput,
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
  updateTask(input: UpdateTaskInput): Promise<BoardBootstrap>;
  moveTask(taskId: string, status: ManualTaskStatus): Promise<BoardBootstrap>;
  deleteTask(taskId: string): Promise<BoardBootstrap>;
  addComment(input: CreateTaskCommentInput): Promise<BoardBootstrap>;
  createSquad(input: CreateSquadInput): Promise<BoardBootstrap>;
  updateSquad(input: UpdateSquadInput): Promise<BoardBootstrap>;
  deleteSquad(squadId: string): Promise<BoardBootstrap>;
  createAutopilot(input: CreateAutopilotInput): Promise<BoardBootstrap>;
  updateAutopilot(input: UpdateAutopilotInput): Promise<BoardBootstrap>;
  deleteAutopilot(autopilotId: string): Promise<BoardBootstrap>;
  triggerAutopilot(autopilotId: string): Promise<BoardBootstrap>;
  dispatchTask(taskId: string): Promise<BoardBootstrap>;
  resolveGate(input: ResolveGateInput): Promise<BoardBootstrap>;
  abortTask(taskId: string): Promise<BoardBootstrap>;
}

export function useKanban(api: StellaDesktopApi): KanbanController {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  useEffect(() => {
    let active = true;
    const unsubscribe = api.onEvent((event: BridgeEvent) => {
      if (!active || event.source !== "board") return;
      if (event.payload.type === "snapshot") dispatch({ type: "BOOTSTRAP", bootstrap: event.payload.bootstrap });
      else if (event.payload.type === "agent-event") dispatch({ type: "EVENT", event: event.payload });
      else if (event.payload.type === "agent-task-event") dispatch({ type: "AGENT_TASK_EVENT", event: event.payload });
      else if (event.payload.type === "automation-runtime") dispatch({ type: "AUTOMATION_RUNTIME", status: event.payload.status });
      else if (event.payload.type === "automation-error") dispatch({ type: "FAILED", error: event.payload.message });
    });
    void api.boardInitialize()
      .then((bootstrap) => { if (active) dispatch({ type: "BOOTSTRAP", bootstrap }); })
      .catch((error: unknown) => { if (active) dispatch({ type: "FAILED", error: errorMessage(error) }); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const perform = useCallback(async (key: string, operation: () => Promise<BoardBootstrap>) => {
    dispatch({ type: "PENDING", key, active: true });
    try {
      const bootstrap = await operation();
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
  const updateTask = useCallback((input: UpdateTaskInput) => perform(input.taskId, () => api.boardUpdateTask(input)), [api, perform]);
  const moveTask = useCallback((taskId: string, status: ManualTaskStatus) => perform(taskId, () => api.boardMoveTask(taskId, status)), [api, perform]);
  const deleteTask = useCallback((taskId: string) => perform(taskId, () => api.boardDeleteTask(taskId)), [api, perform]);
  const addComment = useCallback((input: CreateTaskCommentInput) => perform(input.taskId, () => api.boardAddComment(input)), [api, perform]);
  const createSquad = useCallback((input: CreateSquadInput) => perform("squad:create", () => api.boardCreateSquad(input)), [api, perform]);
  const updateSquad = useCallback((input: UpdateSquadInput) => perform(`squad:${input.squadId}`, () => api.boardUpdateSquad(input)), [api, perform]);
  const deleteSquad = useCallback((squadId: string) => perform(`squad:${squadId}`, () => api.boardDeleteSquad(squadId)), [api, perform]);
  const createAutopilot = useCallback((input: CreateAutopilotInput) => perform("autopilot:create", () => api.boardCreateAutopilot(input)), [api, perform]);
  const updateAutopilot = useCallback((input: UpdateAutopilotInput) => perform(`autopilot:${input.autopilotId}`, () => api.boardUpdateAutopilot(input)), [api, perform]);
  const deleteAutopilot = useCallback((autopilotId: string) => perform(`autopilot:${autopilotId}`, () => api.boardDeleteAutopilot(autopilotId)), [api, perform]);
  const triggerAutopilot = useCallback((autopilotId: string) => perform(`autopilot:${autopilotId}:trigger`, () => api.boardTriggerAutopilot(autopilotId)), [api, perform]);
  const dispatchTask = useCallback((taskId: string) => perform(taskId, () => api.boardDispatchTask(taskId)), [api, perform]);
  const resolveGate = useCallback((input: ResolveGateInput) => perform(input.taskId, () => api.boardResolveGate(input)), [api, perform]);
  const abortTask = useCallback((taskId: string) => perform(taskId, () => api.boardAbortTask(taskId)), [api, perform]);

  return useMemo(() => ({
    state,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    addComment,
    createSquad,
    updateSquad,
    deleteSquad,
    createAutopilot,
    updateAutopilot,
    deleteAutopilot,
    triggerAutopilot,
    dispatchTask,
    resolveGate,
    abortTask,
  }), [abortTask, addComment, createAutopilot, createSquad, createTask, deleteAutopilot, deleteSquad, deleteTask, dispatchTask, moveTask, resolveGate, state, triggerAutopilot, updateAutopilot, updateSquad, updateTask]);
}

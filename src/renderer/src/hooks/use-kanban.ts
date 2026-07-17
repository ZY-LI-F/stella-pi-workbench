import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { BridgeEvent, StellaDesktopApi } from "@shared/contracts";
import type {
  BoardBootstrap,
  BoardBridgeEvent,
  CreateTaskInput,
  ManualTaskStatus,
  ResolveGateInput,
  UpdateTaskInput,
} from "@shared/kanban";

interface KanbanUiState {
  readonly phase: "loading" | "ready" | "error";
  readonly bootstrap?: BoardBootstrap;
  readonly error?: string;
  readonly pending: readonly string[];
  readonly liveEvents: Readonly<Record<string, Extract<BoardBridgeEvent, { type: "agent-event" }>>>;
}

type KanbanAction =
  | { readonly type: "BOOTSTRAP"; readonly bootstrap: BoardBootstrap }
  | { readonly type: "FAILED"; readonly error: string }
  | { readonly type: "PENDING"; readonly key: string; readonly active: boolean }
  | { readonly type: "EVENT"; readonly event: Extract<BoardBridgeEvent, { type: "agent-event" }> };

const INITIAL_STATE: KanbanUiState = Object.freeze({
  phase: "loading",
  pending: Object.freeze([]),
  liveEvents: Object.freeze({}),
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
    return { ...state, phase: "ready", bootstrap: action.bootstrap, error: undefined, liveEvents };
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
  return state;
}

export interface KanbanController {
  readonly state: KanbanUiState;
  createTask(input: CreateTaskInput): Promise<BoardBootstrap>;
  updateTask(input: UpdateTaskInput): Promise<BoardBootstrap>;
  moveTask(taskId: string, status: ManualTaskStatus): Promise<BoardBootstrap>;
  deleteTask(taskId: string): Promise<BoardBootstrap>;
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
      else dispatch({ type: "EVENT", event: event.payload });
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
  const dispatchTask = useCallback((taskId: string) => perform(taskId, () => api.boardDispatchTask(taskId)), [api, perform]);
  const resolveGate = useCallback((input: ResolveGateInput) => perform(input.taskId, () => api.boardResolveGate(input)), [api, perform]);
  const abortTask = useCallback((taskId: string) => perform(taskId, () => api.boardAbortTask(taskId)), [api, perform]);

  return useMemo(() => ({
    state,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    dispatchTask,
    resolveGate,
    abortTask,
  }), [abortTask, createTask, deleteTask, dispatchTask, moveTask, resolveGate, state, updateTask]);
}

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  BridgeEvent,
  PiCommand,
  PiExtensionResponse,
  PiResponse,
  RuntimeBootstrap,
  StellaDesktopApi,
} from "@shared/contracts";
import {
  INITIAL_RUNTIME_STATE,
  runtimeReducer,
  type Notice,
  type RuntimeUiState,
} from "../lib/runtime-state";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PiRuntimeController {
  readonly state: RuntimeUiState;
  command(command: PiCommand, refreshAfter?: boolean): Promise<PiResponse>;
  refresh(): Promise<RuntimeBootstrap>;
  chooseProject(): ReturnType<StellaDesktopApi["chooseProject"]>;
  openProject(path: string, trusted: boolean): Promise<RuntimeBootstrap>;
  respondToExtension(response: PiExtensionResponse): Promise<void>;
  expireExtensionRequest(id: string): void;
  notify(message: string, type?: Notice["type"]): void;
  dismissNotice(id: string): void;
}

export function usePiRuntime(api: StellaDesktopApi): PiRuntimeController {
  const [state, dispatch] = useReducer(runtimeReducer, INITIAL_RUNTIME_STATE);
  const settledRefreshPending = useRef(false);

  const refresh = useCallback(async () => {
    const bootstrap = await api.refresh();
    dispatch({ type: "BOOTSTRAP", payload: bootstrap });
    return bootstrap;
  }, [api]);

  useEffect(() => {
    let active = true;
    const unsubscribe = api.onEvent((event: BridgeEvent) => {
      if (!active) return;
      dispatch({ type: "BRIDGE_EVENT", event });
      if (
        event.source === "pi" &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        "type" in event.payload &&
        event.payload.type === "agent_settled" &&
        !settledRefreshPending.current
      ) {
        settledRefreshPending.current = true;
        void api
          .refresh()
          .then((bootstrap) => {
            if (active) dispatch({ type: "BOOTSTRAP", payload: bootstrap });
          })
          .catch((error: unknown) => {
            if (active) dispatch({ type: "SYNC_FAILED", error: errorMessage(error) });
          })
          .finally(() => {
            settledRefreshPending.current = false;
          });
      }
    });

    void api
      .initialize()
      .then((bootstrap) => {
        if (active) dispatch({ type: "BOOTSTRAP", payload: bootstrap });
      })
      .catch((error: unknown) => {
        if (active) dispatch({ type: "INITIALIZE_FAILED", error: errorMessage(error) });
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  useEffect(() => {
    document.title = state.windowTitle ? `${state.windowTitle} · Stella` : "Stella · Pi Workbench";
  }, [state.windowTitle]);

  const command = useCallback(
    async (piCommand: PiCommand, refreshAfter = false) => {
      try {
        const response = await api.command(piCommand);
        if (refreshAfter) await refresh();
        return response;
      } catch (error) {
        const message = errorMessage(error);
        dispatch({ type: "SYNC_FAILED", error: message });
        throw error;
      }
    },
    [api, refresh],
  );

  const openProject = useCallback(
    async (path: string, trusted: boolean) => {
      try {
        const bootstrap = await api.openProject(path, trusted);
        dispatch({ type: "BOOTSTRAP", payload: bootstrap });
        return bootstrap;
      } catch (error) {
        dispatch({ type: "SYNC_FAILED", error: errorMessage(error) });
        throw error;
      }
    },
    [api],
  );

  const respondToExtension = useCallback(
    async (response: PiExtensionResponse) => {
      await api.respondToExtension(response);
      dispatch({ type: "EXTENSION_RESOLVED", response });
    },
    [api],
  );

  const notify = useCallback((message: string, type: Notice["type"] = "info") => {
    dispatch({
      type: "NOTICE",
      notice: Object.freeze({ id: crypto.randomUUID(), message, type }),
    });
  }, []);

  const dismissNotice = useCallback((id: string) => dispatch({ type: "DISMISS_NOTICE", id }), []);
  const expireExtensionRequest = useCallback(
    (id: string) => dispatch({ type: "EXTENSION_EXPIRED", id }),
    [],
  );

  return useMemo(
    () => ({
      state,
      command,
      refresh,
      chooseProject: () => api.chooseProject(),
      openProject,
      respondToExtension,
      expireExtensionRequest,
      notify,
      dismissNotice,
    }),
    [api, command, dismissNotice, expireExtensionRequest, notify, openProject, refresh, respondToExtension, state],
  );
}

import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { CapabilityHealthSnapshot, CapabilityName } from "@shared/capabilities";
import type { BridgeEvent, StellaDesktopApi } from "@shared/contracts";

interface CapabilityUiState {
  readonly snapshot?: CapabilityHealthSnapshot;
  readonly querying: boolean;
  readonly retrying: readonly CapabilityName[];
  readonly error?: string;
}

type CapabilityAction =
  | { readonly type: "SNAPSHOT"; readonly snapshot: CapabilityHealthSnapshot }
  | { readonly type: "QUERY_FAILED"; readonly error: string }
  | { readonly type: "RETRYING"; readonly name: CapabilityName; readonly active: boolean };

const INITIAL_STATE: CapabilityUiState = Object.freeze({
  querying: true,
  retrying: Object.freeze([]),
});

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function reducer(state: CapabilityUiState, action: CapabilityAction): CapabilityUiState {
  if (action.type === "SNAPSHOT") {
    return Object.freeze({ ...state, snapshot: action.snapshot, querying: false, error: undefined });
  }
  if (action.type === "QUERY_FAILED") {
    return Object.freeze({ ...state, querying: false, error: action.error });
  }
  const retrying = action.active
    ? state.retrying.includes(action.name) ? state.retrying : [...state.retrying, action.name]
    : state.retrying.filter((name) => name !== action.name);
  return Object.freeze({ ...state, retrying: Object.freeze(retrying) });
}

export interface CapabilityController {
  readonly state: CapabilityUiState;
  retry(name: CapabilityName): Promise<CapabilityHealthSnapshot>;
}

export function useCapabilities(api: StellaDesktopApi): CapabilityController {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  useEffect(() => {
    let active = true;
    const unsubscribe = api.onEvent((event: BridgeEvent) => {
      if (!active || event.source !== "capability" || event.payload.type !== "capability-health") return;
      dispatch({ type: "SNAPSHOT", snapshot: event.payload.snapshot });
    });
    void api.capabilities()
      .then((snapshot) => { if (active) dispatch({ type: "SNAPSHOT", snapshot }); })
      .catch((cause: unknown) => { if (active) dispatch({ type: "QUERY_FAILED", error: errorMessage(cause) }); });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);

  const retry = useCallback(async (name: CapabilityName) => {
    dispatch({ type: "RETRYING", name, active: true });
    try {
      const snapshot = await api.retryCapability(name);
      dispatch({ type: "SNAPSHOT", snapshot });
      return snapshot;
    } catch (cause) {
      dispatch({ type: "QUERY_FAILED", error: errorMessage(cause) });
      throw cause;
    } finally {
      dispatch({ type: "RETRYING", name, active: false });
    }
  }, [api]);

  return useMemo(() => ({ state, retry }), [retry, state]);
}

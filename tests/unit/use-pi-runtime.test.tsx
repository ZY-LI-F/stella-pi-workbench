// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeBootstrap, StellaDesktopApi } from "../../src/shared/contracts";
import {
  isReportedRuntimeError,
  usePiRuntime,
} from "../../src/renderer/src/hooks/use-pi-runtime";

function pendingBootstrap(): Promise<RuntimeBootstrap> {
  return new Promise(() => undefined);
}

function runtimeApi(overrides: Partial<StellaDesktopApi>): StellaDesktopApi {
  return {
    initialize: vi.fn(pendingBootstrap),
    onEvent: vi.fn(() => () => undefined),
    ...overrides,
  } as unknown as StellaDesktopApi;
}

afterEach(() => cleanup());

describe("usePiRuntime error reporting", () => {
  it("marks command failures that were already emitted as visible runtime notices", async () => {
    const api = runtimeApi({ command: vi.fn(async () => { throw new Error("RPC transport failed"); }) });
    const { result } = renderHook(() => usePiRuntime(api));
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.command({ type: "abort" });
      } catch (cause) {
        caught = cause;
      }
    });

    expect(isReportedRuntimeError(caught)).toBe(true);
    await waitFor(() => expect(result.current.state.notices.at(-1)?.message).toBe("RPC transport failed"));
  });

  it("treats a cancelled main-process trust prompt as no state change, not an error", async () => {
    const api = runtimeApi({ openProject: vi.fn(async () => null) });
    const { result } = renderHook(() => usePiRuntime(api));
    let opened: RuntimeBootstrap | null | undefined;

    await act(async () => {
      opened = await result.current.openProject("C:/project", true);
    });

    expect(opened).toBeNull();
    expect(result.current.state.notices).toEqual([]);
    expect(result.current.state.bootstrap).toBeUndefined();
  });
});

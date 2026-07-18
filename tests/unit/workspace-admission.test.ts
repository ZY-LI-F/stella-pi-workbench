// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import type { PiCommand, PiResponse } from "../../src/shared/contracts";
import { InteractiveCommandRouter } from "../../src/main/interactive-command-router";
import {
  WorkspaceAdmission,
  WorkspaceAdmissionAbortError,
  WorkspaceBusyError,
  assertAgentWorkspacePolicy,
  canonicalWorkspaceKey,
} from "../../src/main/workspace-admission";

const canonicalize = async (value: string) => value.replaceAll("\\", "/").toLocaleLowerCase("en-US");

function backgroundOwner(id: string) {
  return Object.freeze({ id, kind: "workflow" as const, label: `Workflow ${id}`, taskId: `task-${id}`, executionId: id });
}

describe("WorkspaceAdmission", () => {
  it("uses a canonical absolute real path and the platform case rule", async () => {
    const direct = await canonicalWorkspaceKey(process.cwd());
    const aliased = await canonicalWorkspaceKey(join(process.cwd(), "src", ".."));
    expect(aliased).toBe(direct);
    expect(direct).toMatch(process.platform === "win32" ? /^[a-z]:\\/ : /^\//);
    if (process.platform === "win32") expect(direct).toBe(direct.toLocaleLowerCase("en-US"));
  });

  it("canonicalizes aliases and grants background waiters in FIFO order", async () => {
    let id = 0;
    const admission = new WorkspaceAdmission({ canonicalize, id: () => `lease-${++id}` });
    const first = await admission.acquireBackground("C:\\Repo", backgroundOwner("one"));
    const order: string[] = [];
    const secondPromise = admission.acquireBackground("c:/repo", backgroundOwner("two")).then((lease) => { order.push("two"); return lease; });
    const thirdPromise = admission.acquireBackground("C:/REPO", backgroundOwner("three")).then((lease) => { order.push("three"); return lease; });

    first.release();
    const second = await secondPromise;
    expect(order).toEqual(["two"]);
    second.release();
    const third = await thirdPromise;
    expect(order).toEqual(["two", "three"]);
    third.release();
    expect(await admission.currentOwner("c:/repo")).toBeUndefined();
  });

  it("rejects Interactive work with the exact background owner", async () => {
    const admission = new WorkspaceAdmission({ canonicalize });
    const owner = backgroundOwner("build-42");
    const lease = await admission.acquireBackground("C:/repo", owner);

    await expect(admission.acquireInteractive("c:/REPO", {
      id: "interactive",
      kind: "interactive",
      label: "Interactive Pi",
    })).rejects.toMatchObject({
      name: "WorkspaceBusyError",
      owner,
      message: expect.stringContaining("task-build-42"),
    });
    lease.release();
  });

  it("cancels a queued waiter without granting it later", async () => {
    const admission = new WorkspaceAdmission({ canonicalize });
    const first = await admission.acquireBackground("C:/repo", backgroundOwner("one"));
    const controller = new AbortController();
    const queued = admission.acquireBackground("C:/repo", backgroundOwner("cancelled"), { signal: controller.signal });
    controller.abort();
    await expect(queued).rejects.toBeInstanceOf(WorkspaceAdmissionAbortError);
    first.release();
    expect(await admission.currentOwner("C:/repo")).toBeUndefined();
  });

  it("validates that a read-only label has only verified read tools", () => {
    expect(() => assertAgentWorkspacePolicy({ id: "reader", workspaceAccess: "read", allowedTools: ["read", "grep"] })).not.toThrow();
    expect(() => assertAgentWorkspacePolicy({ id: "unsafe", workspaceAccess: "read", allowedTools: ["read", "bash"] })).toThrow("未验证工具: bash");
  });

  it("releases all queued and active state on shutdown", async () => {
    const admission = new WorkspaceAdmission({ canonicalize });
    await admission.acquireBackground("C:/repo", backgroundOwner("one"));
    const onQueued = vi.fn(async () => undefined);
    const queued = admission.acquireBackground("C:/repo", backgroundOwner("two"), { onQueued });
    await vi.waitFor(() => expect(onQueued).toHaveBeenCalledOnce());
    admission.shutdown();
    await expect(queued).rejects.toThrow("Stella 关闭");
    await expect(admission.acquireBackground("C:/repo", backgroundOwner("three"))).rejects.toThrow("已关闭");
  });
});

describe("InteractiveCommandRouter", () => {
  it("holds a turn lease until agent_settled and delays background launch", async () => {
    const admission = new WorkspaceAdmission({ canonicalize });
    const runtime = { send: vi.fn(async (command: PiCommand): Promise<PiResponse> => ({ id: "1", type: "response", command: command.type, success: true })) };
    const router = new InteractiveCommandRouter({ runtime, admission, id: () => "interactive-turn" });
    await router.send({ type: "prompt", message: "修改项目" }, "C:/repo");
    let granted = false;
    const background = admission.acquireBackground("c:/REPO", backgroundOwner("waiting")).then((lease) => { granted = true; return lease; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(granted).toBe(false);

    router.handlePiEvent({ type: "agent_settled" });
    const lease = await background;
    expect(granted).toBe(true);
    lease.release();
  });

  it("rejects prompt and bash while a background owner holds the workspace", async () => {
    const admission = new WorkspaceAdmission({ canonicalize });
    const ownerLease = await admission.acquireBackground("C:/repo", backgroundOwner("busy"));
    const runtime = { send: vi.fn(async () => ({ id: "1", type: "response", command: "prompt", success: true } as PiResponse)) };
    const router = new InteractiveCommandRouter({ runtime, admission });

    await expect(router.send({ type: "prompt", message: "race" }, "C:/repo")).rejects.toBeInstanceOf(WorkspaceBusyError);
    await expect(router.send({ type: "bash", command: "git status" }, "C:/repo")).rejects.toBeInstanceOf(WorkspaceBusyError);
    expect(runtime.send).not.toHaveBeenCalled();
    ownerLease.release();
  });
});

import { realpath } from "node:fs/promises";
import { normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentDefinition } from "../shared/kanban";

export type WorkspaceOwnerKind = "interactive" | "workflow" | "agent-task";

export interface WorkspaceOwner {
  readonly id: string;
  readonly kind: WorkspaceOwnerKind;
  readonly label: string;
  readonly taskId?: string;
  readonly executionId?: string;
}

export interface WorkspaceLease {
  readonly key: string;
  readonly owner: WorkspaceOwner;
  release(): void;
}

interface WorkspaceAdmissionDependencies {
  readonly canonicalize?: (workspacePath: string) => Promise<string>;
  readonly id?: () => string;
}

interface BackgroundAcquireOptions {
  readonly signal?: AbortSignal;
  readonly onQueued?: (blockingOwner: WorkspaceOwner) => Promise<void>;
}

interface ActiveLease {
  readonly token: string;
  readonly owner: WorkspaceOwner;
}

interface Waiter {
  readonly token: string;
  readonly owner: WorkspaceOwner;
  readonly signal?: AbortSignal;
  readonly resolve: (lease: WorkspaceLease) => void;
  readonly reject: (cause: Error) => void;
  readonly abort: () => void;
}

interface WorkspaceState {
  readonly active: ActiveLease;
  readonly waiters: readonly Waiter[];
}

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} 必须是非空字符串`);
  return normalized;
}

function frozenOwner(owner: WorkspaceOwner): WorkspaceOwner {
  return Object.freeze({
    id: required(owner.id, "Workspace owner id"),
    kind: owner.kind,
    label: required(owner.label, "Workspace owner label"),
    taskId: owner.taskId,
    executionId: owner.executionId,
  });
}

export async function canonicalWorkspaceKey(workspacePath: string): Promise<string> {
  const absolute = resolve(required(workspacePath, "Workspace path"));
  const canonical = normalize(resolve(await realpath(absolute)));
  return process.platform === "win32" ? canonical.toLocaleLowerCase("en-US") : canonical;
}

export function assertAgentWorkspacePolicy(agent: Pick<AgentDefinition, "id" | "workspaceAccess" | "allowedTools">): void {
  if (agent.workspaceAccess !== "read") return;
  const unsafeTools = agent.allowedTools.filter((tool) => !READ_ONLY_TOOLS.has(tool));
  if (unsafeTools.length > 0) {
    throw new Error(`只读 Agent ${agent.id} 配置了可写或未验证工具: ${unsafeTools.join(", ")}`);
  }
}

export class WorkspaceBusyError extends Error {
  readonly workspaceKey: string;
  readonly owner: WorkspaceOwner;

  constructor(workspaceKey: string, owner: WorkspaceOwner) {
    const identity = owner.taskId ? `，Task ${owner.taskId}` : "";
    super(`工作区 ${workspaceKey} 正由 ${owner.label}（${owner.kind}${identity}）占用`);
    this.name = "WorkspaceBusyError";
    this.workspaceKey = workspaceKey;
    this.owner = owner;
  }
}

export class WorkspaceAdmissionAbortError extends Error {
  constructor(message = "工作区准入等待已取消") {
    super(message);
    this.name = "WorkspaceAdmissionAbortError";
  }
}

export class WorkspaceAdmission {
  readonly #canonicalize: (workspacePath: string) => Promise<string>;
  readonly #id: () => string;
  readonly #states = new Map<string, WorkspaceState>();
  #shutdown = false;

  constructor(dependencies: WorkspaceAdmissionDependencies = {}) {
    this.#canonicalize = dependencies.canonicalize ?? canonicalWorkspaceKey;
    this.#id = dependencies.id ?? randomUUID;
  }

  async acquireInteractive(workspacePath: string, ownerInput: WorkspaceOwner): Promise<WorkspaceLease> {
    this.#assertRunning();
    const key = await this.#canonicalize(workspacePath);
    this.#assertRunning();
    const state = this.#states.get(key);
    if (state) throw new WorkspaceBusyError(key, state.active.owner);
    const owner = frozenOwner(ownerInput);
    const active = Object.freeze({ token: this.#id(), owner });
    this.#states.set(key, Object.freeze({ active, waiters: Object.freeze([]) }));
    return this.#lease(key, active);
  }

  async acquireBackground(
    workspacePath: string,
    ownerInput: WorkspaceOwner,
    options: BackgroundAcquireOptions = {},
  ): Promise<WorkspaceLease> {
    this.#assertRunning();
    const key = await this.#canonicalize(workspacePath);
    this.#assertRunning();
    if (options.signal?.aborted) throw new WorkspaceAdmissionAbortError();
    const owner = frozenOwner(ownerInput);
    let state = this.#states.get(key);
    if (!state) {
      const active = Object.freeze({ token: this.#id(), owner });
      this.#states.set(key, Object.freeze({ active, waiters: Object.freeze([]) }));
      return this.#lease(key, active);
    }

    if (options.onQueued) await options.onQueued(state.active.owner);
    this.#assertRunning();
    if (options.signal?.aborted) throw new WorkspaceAdmissionAbortError();
    state = this.#states.get(key);
    if (!state) {
      const active = Object.freeze({ token: this.#id(), owner });
      this.#states.set(key, Object.freeze({ active, waiters: Object.freeze([]) }));
      return this.#lease(key, active);
    }

    return new Promise<WorkspaceLease>((resolveWaiter, rejectWaiter) => {
      const token = this.#id();
      const abort = () => {
        const latest = this.#states.get(key);
        if (!latest) return;
        const waiters = latest.waiters.filter((waiter) => waiter.token !== token);
        if (waiters.length === latest.waiters.length) return;
        this.#states.set(key, Object.freeze({ active: latest.active, waiters: Object.freeze(waiters) }));
        rejectWaiter(new WorkspaceAdmissionAbortError());
      };
      const waiter: Waiter = Object.freeze({ token, owner, signal: options.signal, resolve: resolveWaiter, reject: rejectWaiter, abort });
      options.signal?.addEventListener("abort", abort, { once: true });
      this.#states.set(key, Object.freeze({ active: state.active, waiters: Object.freeze([...state.waiters, waiter]) }));
    });
  }

  async currentOwner(workspacePath: string): Promise<WorkspaceOwner | undefined> {
    const key = await this.#canonicalize(workspacePath);
    return this.#states.get(key)?.active.owner;
  }

  shutdown(): void {
    if (this.#shutdown) return;
    this.#shutdown = true;
    const error = new WorkspaceAdmissionAbortError("Stella 关闭，工作区准入等待已取消");
    for (const state of this.#states.values()) {
      for (const waiter of state.waiters) {
        waiter.signal?.removeEventListener("abort", waiter.abort);
        waiter.reject(error);
      }
    }
    this.#states.clear();
  }

  #lease(key: string, active: ActiveLease): WorkspaceLease {
    let released = false;
    return Object.freeze({
      key,
      owner: active.owner,
      release: () => {
        if (released) return;
        released = true;
        this.#release(key, active.token);
      },
    });
  }

  #release(key: string, token: string): void {
    const state = this.#states.get(key);
    if (!state || state.active.token !== token) return;
    const [next, ...remaining] = state.waiters;
    if (!next) {
      this.#states.delete(key);
      return;
    }
    next.signal?.removeEventListener("abort", next.abort);
    const active = Object.freeze({ token: next.token, owner: next.owner });
    this.#states.set(key, Object.freeze({ active, waiters: Object.freeze(remaining) }));
    next.resolve(this.#lease(key, active));
  }

  #assertRunning(): void {
    if (this.#shutdown) throw new WorkspaceAdmissionAbortError("WorkspaceAdmission 已关闭");
  }
}

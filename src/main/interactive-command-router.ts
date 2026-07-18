import { randomUUID } from "node:crypto";
import type { PiCommand, PiResponse, RuntimeSignal } from "../shared/contracts";
import { WorkspaceAdmission, type WorkspaceLease } from "./workspace-admission";

interface InteractiveRuntime {
  send(command: PiCommand): Promise<PiResponse>;
}

interface InteractiveCommandRouterDependencies {
  readonly runtime: InteractiveRuntime;
  readonly admission: WorkspaceAdmission;
  readonly id?: () => string;
}

interface InteractiveLeaseState {
  readonly workspacePath: string;
  readonly lease: WorkspaceLease;
}

const TURN_COMMANDS = new Set<PiCommand["type"]>(["prompt", "steer", "follow_up"]);

function eventType(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

export class InteractiveCommandRouter {
  readonly #runtime: InteractiveRuntime;
  readonly #admission: WorkspaceAdmission;
  readonly #id: () => string;
  #active?: InteractiveLeaseState;

  constructor(dependencies: InteractiveCommandRouterDependencies) {
    this.#runtime = dependencies.runtime;
    this.#admission = dependencies.admission;
    this.#id = dependencies.id ?? randomUUID;
  }

  async send(command: PiCommand, workspacePath: string): Promise<PiResponse> {
    if (TURN_COMMANDS.has(command.type)) return this.#sendTurn(command, workspacePath);
    if (command.type === "bash") return this.#sendBash(command, workspacePath);
    return this.#runtime.send(command);
  }

  handlePiEvent(event: unknown): void {
    if (eventType(event) === "agent_settled") this.release();
  }

  handleRuntimeSignal(signal: RuntimeSignal): void {
    if (signal.type === "runtime_exit") this.release();
  }

  release(): void {
    const active = this.#active;
    this.#active = undefined;
    active?.lease.release();
  }

  async #sendTurn(command: PiCommand, workspacePath: string): Promise<PiResponse> {
    const existing = this.#active;
    if (existing && existing.workspacePath !== workspacePath) {
      throw new Error(`Interactive Pi 已占用另一工作区: ${existing.workspacePath}`);
    }
    const newlyAcquired = !existing;
    if (newlyAcquired) {
      const lease = await this.#admission.acquireInteractive(workspacePath, {
        id: this.#id(),
        kind: "interactive",
        label: "Interactive Pi",
      });
      this.#active = Object.freeze({ workspacePath, lease });
    }
    try {
      return await this.#runtime.send(command);
    } catch (cause) {
      if (newlyAcquired) this.release();
      throw cause;
    }
  }

  async #sendBash(command: PiCommand, workspacePath: string): Promise<PiResponse> {
    if (this.#active) return this.#runtime.send(command);
    const lease = await this.#admission.acquireInteractive(workspacePath, {
      id: this.#id(),
      kind: "interactive",
      label: "Interactive Pi Bash",
    });
    try {
      return await this.#runtime.send(command);
    } finally {
      lease.release();
    }
  }
}

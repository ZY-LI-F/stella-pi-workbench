import type {
  CapabilityHealth,
  CapabilityHealthSnapshot,
  CapabilityName,
  CapabilityState,
} from "../shared/capabilities";

interface CapabilityHealthStoreDependencies {
  readonly now: () => string;
  readonly emitChanged: (snapshot: CapabilityHealthSnapshot) => void;
}

function freezeHealth(state: CapabilityState, updatedAt: string, error?: string): CapabilityHealth {
  if ((state === "error" || state === "degraded") && !error?.trim()) {
    throw new Error(`${state} Capability 必须提供错误原因`);
  }
  if ((state === "loading" || state === "ready") && error !== undefined) {
    throw new Error(`${state} Capability 不能携带错误原因`);
  }
  return Object.freeze({ state, error, updatedAt });
}

export class CapabilityHealthStore {
  readonly #dependencies: CapabilityHealthStoreDependencies;
  #snapshot: CapabilityHealthSnapshot;

  constructor(dependencies: CapabilityHealthStoreDependencies) {
    this.#dependencies = dependencies;
    const now = dependencies.now();
    this.#snapshot = Object.freeze({
      pi: freezeHealth("loading", now),
      task: freezeHealth("loading", now),
      schedule: freezeHealth("loading", now),
      webhook: freezeHealth("loading", now),
    });
  }

  snapshot(): CapabilityHealthSnapshot {
    return this.#snapshot;
  }

  set(name: CapabilityName, state: CapabilityState, error?: string): CapabilityHealthSnapshot {
    const next = Object.freeze({
      ...this.#snapshot,
      [name]: freezeHealth(state, this.#dependencies.now(), error),
    });
    this.#snapshot = next;
    this.#dependencies.emitChanged(next);
    return next;
  }

  async run(name: CapabilityName, start: () => Promise<void>): Promise<boolean> {
    this.set(name, "loading");
    try {
      await start();
      this.set(name, "ready");
      return true;
    } catch (cause) {
      this.set(name, "error", cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  }
}

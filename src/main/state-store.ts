import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RecentProject } from "../shared/contracts";

interface PersistedState {
  readonly lastProject?: string;
  readonly recentProjects: readonly RecentProject[];
}
const EMPTY_STATE: PersistedState = Object.freeze({ recentProjects: [] });

function isRecentProject(value: unknown): value is RecentProject {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === "string" &&
    typeof record.trusted === "boolean" &&
    typeof record.lastOpened === "string"
  );
}

function parseState(contents: string, path: string): PersistedState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法解析 Stella 状态文件 ${path}: ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Stella 状态文件 ${path} 必须是 JSON 对象`);
  }

  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.recentProjects) || !record.recentProjects.every(isRecentProject)) {
    throw new Error(`Stella 状态文件 ${path} 的 recentProjects 无效`);
  }
  if (record.lastProject !== undefined && typeof record.lastProject !== "string") {
    throw new Error(`Stella 状态文件 ${path} 的 lastProject 无效`);
  }

  return {
    lastProject: record.lastProject as string | undefined,
    recentProjects: Object.freeze([...record.recentProjects]),
  };
}

export class StateStore {
  readonly #path: string;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.#path = path;
  }

  async read(): Promise<PersistedState> {
    try {
      return parseState(await readFile(this.#path, "utf8"), this.#path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return EMPTY_STATE;
      throw error;
    }
  }

  recordProject(path: string, trusted: boolean): Promise<PersistedState> {
    const operation = this.#writeQueue.then(async () => {
      const current = await this.read();
      const opened: RecentProject = Object.freeze({ path, trusted, lastOpened: new Date().toISOString() });
      const recentProjects = Object.freeze([
        opened,
        ...current.recentProjects.filter((project) => project.path !== path),
      ].slice(0, 12));
      const next: PersistedState = Object.freeze({ lastProject: path, recentProjects });
      await this.#write(next);
      return next;
    });
    this.#writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async #write(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    const tempPath = `${this.#path}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.#path);
  }
}

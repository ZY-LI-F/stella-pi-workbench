import { realpath } from "node:fs/promises";
import { normalize, resolve, sep } from "node:path";

type RealpathResolver = (absolutePath: string) => Promise<string>;

interface CanonicalPathDependencies {
  readonly resolveRealPath?: RealpathResolver;
  readonly platform?: NodeJS.Platform;
}

function requiredPath(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("路径必须是非空字符串");
  return normalized;
}

function missingPath(cause: unknown): boolean {
  const code = (cause as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export async function canonicalExistingPath(
  value: string,
  dependencies: CanonicalPathDependencies = {},
): Promise<string> {
  const absolute = resolve(requiredPath(value));
  const resolveRealPath = dependencies.resolveRealPath ?? ((path) => realpath(path));
  return normalize(resolve(await resolveRealPath(absolute)));
}

export function pathComparisonKey(value: string, platform: NodeJS.Platform = process.platform): string {
  const absolute = normalize(resolve(requiredPath(value)));
  return platform === "win32" ? absolute.toLocaleLowerCase("en-US") : absolute;
}

export function isCanonicalPathWithin(
  candidatePath: string,
  rootPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const candidate = pathComparisonKey(candidatePath, platform);
  const root = pathComparisonKey(rootPath, platform);
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

export async function canonicalExecutionProjectPath(
  value: string,
  trusted: boolean,
  dependencies: CanonicalPathDependencies = {},
): Promise<string> {
  const requested = resolve(requiredPath(value));
  const canonical = await canonicalExistingPath(requested, dependencies);
  if (pathComparisonKey(requested, dependencies.platform) !== pathComparisonKey(canonical, dependencies.platform)) {
    const trustContext = trusted ? "受信任项目" : "项目";
    throw new Error(`${trustContext}路径的真实位置已变化，拒绝执行历史任务: ${requested} -> ${canonical}`);
  }
  return canonical;
}

export async function canonicalPathWithinRoots(
  candidatePath: string,
  rootPaths: readonly string[],
  dependencies: CanonicalPathDependencies = {},
): Promise<string | null> {
  const candidate = await canonicalExistingPath(candidatePath, dependencies);
  for (const rootPath of rootPaths) {
    let root: string;
    try {
      root = await canonicalExistingPath(rootPath, dependencies);
    } catch (cause) {
      // 不存在的允许目录不可能包含一个已存在的候选路径，因此不授予访问权。
      if (missingPath(cause)) continue;
      throw cause;
    }
    if (isCanonicalPathWithin(candidate, root, dependencies.platform)) return candidate;
  }
  return null;
}

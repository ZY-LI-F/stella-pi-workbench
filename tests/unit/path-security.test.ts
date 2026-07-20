// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import {
  canonicalExecutionProjectPath,
  canonicalExistingPath,
  canonicalPathWithinRoots,
  isCanonicalPathWithin,
  pathComparisonKey,
} from "../../src/main/path-security";

describe("path security", () => {
  it("compares complete path segments instead of accepting sibling prefixes", () => {
    const root = resolve("workspace", "trusted");
    expect(isCanonicalPathWithin(join(root, "reports", "result.html"), root)).toBe(true);
    expect(isCanonicalPathWithin(resolve("workspace", "trusted-copy", "result.html"), root)).toBe(false);
  });

  it("uses the real target when a junction or symlink points outside an allowed root", async () => {
    const trustedRoot = resolve("workspace", "trusted");
    const aliasCandidate = join(trustedRoot, "linked", "result.html");
    const outsideCandidate = resolve("workspace", "outside", "result.html");
    const resolveRealPath = async (absolutePath: string) => {
      if (pathComparisonKey(absolutePath) === pathComparisonKey(aliasCandidate)) return outsideCandidate;
      return absolutePath;
    };

    const canonical = await canonicalExistingPath(aliasCandidate, { resolveRealPath });
    const admitted = await canonicalPathWithinRoots(aliasCandidate, [trustedRoot], { resolveRealPath });

    expect(pathComparisonKey(canonical)).toBe(pathComparisonKey(outsideCandidate));
    expect(admitted).toBeNull();
  });

  it("rejects inherited trust when a background execution path resolves elsewhere", async () => {
    const savedProjectPath = resolve("workspace", "trusted-alias");
    const retargetedProjectPath = resolve("workspace", "retargeted-project");
    const resolveRealPath = async (absolutePath: string) =>
      pathComparisonKey(absolutePath) === pathComparisonKey(savedProjectPath) ? retargetedProjectPath : absolutePath;

    await expect(canonicalExecutionProjectPath(savedProjectPath, true, { resolveRealPath })).rejects.toThrow(
      "受信任项目路径的真实位置已变化",
    );
    await expect(canonicalExecutionProjectPath(savedProjectPath, false, { resolveRealPath })).rejects.toThrow(
      "拒绝执行历史任务",
    );
  });

  it("returns the canonical target when it remains inside an allowed real root", async () => {
    const trustedRoot = resolve("workspace", "trusted");
    const aliasCandidate = join(trustedRoot, "linked", "result.html");
    const realCandidate = join(trustedRoot, "reports", "result.html");
    const resolveRealPath = async (absolutePath: string) => {
      if (pathComparisonKey(absolutePath) === pathComparisonKey(aliasCandidate)) return realCandidate;
      return absolutePath;
    };

    await expect(canonicalPathWithinRoots(aliasCandidate, [trustedRoot], { resolveRealPath })).resolves.toBe(realCandidate);
  });
});

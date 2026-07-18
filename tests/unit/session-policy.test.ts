import { describe, expect, it } from "vitest";
import type { SessionSummary } from "../../src/shared/contracts";
import { backgroundSessionName, isBackgroundSessionName, STELLA_BACKGROUND_SESSION_MARKER, visibleInteractiveSessions } from "../../src/shared/session-policy";

function session(id: string, name?: string): SessionSummary {
  return Object.freeze({ path: `C:/sessions/${id}.jsonl`, id, cwd: "C:/project", name, created: "2026-07-18T00:00:00.000Z", modified: "2026-07-18T00:00:00.000Z", messageCount: 1, firstMessage: id });
}

describe("background session policy", () => {
  it("builds a stable machine marker for every background runtime", () => {
    const name = backgroundSessionName({ taskId: "task-1", executionKind: "agent-task", executionId: "agent-task-1", label: "实现" });
    expect(name).toBe(`${STELLA_BACKGROUND_SESSION_MARKER} task:task-1 agent-task:agent-task-1 · 实现`);
    expect(isBackgroundSessionName(name)).toBe(true);
  });

  it("filters marked and legacy Stella execution sessions from ordinary Pi history", () => {
    const interactive = session("interactive", "用户会话");
    const background = session("background", backgroundSessionName({ taskId: "task-1", executionKind: "workflow-step", executionId: "step-1", label: "验证" }));
    const legacy = session("legacy", "[Stella] 旧任务 · 实现");
    const visible = visibleInteractiveSessions([background, interactive, legacy]);
    expect(visible).toEqual([interactive]);
    expect(Object.isFrozen(visible)).toBe(true);
  });
});

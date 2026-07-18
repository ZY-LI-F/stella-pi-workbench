import { describe, expect, it } from "vitest";
import type { RuntimeBootstrap } from "../../src/shared/contracts";
import { createPiTaskDraft } from "../../src/renderer/src/features/kanban/pi-task-draft";

function bootstrap(): RuntimeBootstrap {
  return {
    project: { cwd: "C:/project", name: "project", trusted: true, requiresTrust: false },
    recentProjects: [],
    state: {
      sessionId: "pi-session-1",
      sessionFile: "C:/sessions/pi-session-1.jsonl",
      thinkingLevel: "off",
      isStreaming: false,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      autoCompactionEnabled: true,
      messageCount: 2,
      pendingMessageCount: 0,
    },
    messages: [
      { role: "user", content: "实现可视化任务房间", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "我建议使用纯投影。" }], provider: "test", model: "test", stopReason: "stop", timestamp: 2 },
    ],
    models: [], commands: [],
    sessions: [{ path: "C:/sessions/pi-session-1.jsonl", id: "pi-session-1", cwd: "C:/project", name: "Task Room 设计", created: "2026-07-18T00:00:00.000Z", modified: "2026-07-18T00:01:00.000Z", messageCount: 2, firstMessage: "实现可视化任务房间" }],
    stats: { sessionFile: "C:/sessions/pi-session-1.jsonl", sessionId: "pi-session-1", userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 },
    entries: [], tree: [], leafId: null, piVersion: "1.0.0",
  } as RuntimeBootstrap;
}

describe("createPiTaskDraft", () => {
  it("creates an editable draft with source identity without mutating the board", () => {
    const source = bootstrap();
    const draft = createPiTaskDraft(source);
    expect(draft).toEqual({
      title: "Task Room 设计",
      description: "## 当前请求\n实现可视化任务房间\n\n## 最近答复\n我建议使用纯投影。",
      acceptanceCriteria: "",
      priority: "medium",
      sourcePiSessionPath: "C:/sessions/pi-session-1.jsonl",
      sourcePiSessionId: "pi-session-1",
    });
    expect(Object.isFrozen(draft)).toBe(true);
  });

  it("fails explicitly while the current Pi session has no persisted file", () => {
    const source = bootstrap();
    expect(() => createPiTaskDraft({ ...source, state: { ...source.state, sessionFile: undefined } }))
      .toThrow("当前 Pi 会话尚未生成可持久化的 session 文件");
  });
});

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeBootstrap } from "@shared/contracts";
import { Sidebar } from "@renderer/components/Sidebar";

afterEach(() => cleanup());

function bootstrap(): RuntimeBootstrap {
  return {
    project: { cwd: "C:/project", name: "project", trusted: true, requiresTrust: false },
    recentProjects: [],
    state: {
      sessionFile: "C:/sessions/running.jsonl",
      sessionId: "running-session",
      sessionName: undefined,
      messageCount: 1,
      thinkingLevel: "off",
      isStreaming: true,
      isCompacting: false,
      steeringMode: "all",
      followUpMode: "all",
      autoCompactionEnabled: true,
      pendingMessageCount: 0,
    },
    messages: [{ role: "user", content: "生成 CDK2 早研任务", timestamp: Date.now() }],
    sessions: [],
    models: [],
    commands: [],
    stats: {
      sessionFile: "C:/sessions/running.jsonl",
      sessionId: "running-session",
      userMessages: 1,
      assistantMessages: 0,
      toolCalls: 0,
      toolResults: 0,
      totalMessages: 1,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      cost: 0,
    },
    entries: [],
    tree: [],
    leafId: null,
    piVersion: "0.80.10",
  } as unknown as RuntimeBootstrap;
}

function renderSidebar(source = bootstrap()) {
  return render(
    <Sidebar
      bootstrap={source}
      capabilities={{ pi: { state: "ready" }, task: { state: "ready" }, schedule: { state: "ready" }, webhook: { state: "ready" } }}
      skin="stella"
      open
      activeView="chat"
      modelChanging={false}
      onClose={() => undefined}
      onNewSession={() => undefined}
      onNewTask={() => undefined}
      onSwitchView={() => undefined}
      onChooseProject={() => undefined}
      onOpenRecentProject={() => undefined}
      onSwitchSession={() => undefined}
      onOpenPalette={() => undefined}
      onOpenTerminal={() => undefined}
      onOpenInspector={() => undefined}
      onOpenSettings={() => undefined}
      onModelChange={() => undefined}
    />,
  );
}

describe("Sidebar", () => {
  it("shows the current running session before it appears in historical session summaries", () => {
    renderSidebar();

    expect(screen.getByRole("button", { name: /生成 CDK2 早研任务/ })).toBeTruthy();
    expect(screen.queryByText("这个项目还没有会话。")).toBeNull();
  });

  it("does not duplicate the current session when Pi already returns it in history", () => {
    const source = bootstrap();
    const session = {
      path: "C:/sessions/running.jsonl",
      id: "running-session",
      cwd: "C:/project",
      name: "历史标题",
      created: "2026-07-18T00:00:00.000Z",
      modified: "2026-07-18T00:01:00.000Z",
      messageCount: 2,
      firstMessage: "历史消息",
    };
    renderSidebar({ ...source, sessions: [session] } as RuntimeBootstrap);

    expect(screen.getAllByRole("button", { name: /生成 CDK2 早研任务|历史标题/ })).toHaveLength(1);
  });
});

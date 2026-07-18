import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import type { Autopilot, KanbanTask } from "../../src/shared/kanban";
import { TaskDetailPanel } from "../../src/renderer/src/features/kanban/TaskDetailPanel";
import { TaskEditorDialog } from "../../src/renderer/src/features/kanban/TaskEditorDialog";
import { AutomationStudioDialog } from "../../src/renderer/src/features/kanban/AutomationStudioDialog";

afterEach(() => cleanup());

const PROJECT = Object.freeze({
  cwd: "C:/project",
  name: "project",
  branch: "main",
  trusted: true,
  requiresTrust: false,
});

const TASK: KanbanTask = Object.freeze({
  id: "task-1",
  title: "自动化任务",
  description: "真实执行",
  acceptanceCriteria: "保存结果",
  priority: "high",
  projectPath: PROJECT.cwd,
  projectName: PROJECT.name,
  trusted: PROJECT.trusted,
  executionTarget: Object.freeze({ kind: "agent", agentId: "builder" }),
  status: "planned",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
});

const WEBHOOK_AUTOPILOT: Autopilot = Object.freeze({
  id: "autopilot-webhook",
  name: "本机构建回调",
  enabled: true,
  trigger: Object.freeze({ kind: "webhook", token: "visible-random-token" }),
  taskTemplate: Object.freeze({ title: "处理回调", description: "读取上下文", acceptanceCriteria: "保存结果", priority: "high" }),
  projectPath: PROJECT.cwd,
  projectName: PROJECT.name,
  trusted: true,
  executionTarget: Object.freeze({ kind: "agent", agentId: "builder" }),
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
});

describe("Kanban automation interactions", () => {
  it("creates a task with a selected direct Agent execution target", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => undefined);
    render(
      <TaskEditorDialog
        project={PROJECT}
        workflows={BUILTIN_ORCHESTRATION_CATALOG.workflows}
        agents={BUILTIN_ORCHESTRATION_CATALOG.agents}
        squads={[]}
        busy={false}
        onClose={() => undefined}
        onCreate={onCreate}
        onUpdate={async () => undefined}
      />,
    );

    await user.type(screen.getByPlaceholderText("清楚描述要交付的结果"), "直接 Agent 交付");
    await user.click(screen.getByRole("tab", { name: "单 Agent" }));
    await user.click(screen.getByRole("button", { name: /实现工程师/ }));
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: "直接 Agent 交付",
      executionTarget: { kind: "agent", agentId: "builder" },
    })));
  });

  it("sends a visible task comment from task detail", async () => {
    const user = userEvent.setup();
    const onAddComment = vi.fn(async () => undefined);
    render(
      <TaskDetailPanel
        task={TASK}
        catalog={BUILTIN_ORCHESTRATION_CATALOG}
        squads={[]}
        runs={[]}
        agentTasks={[]}
        comments={[]}
        activities={[]}
        busy={false}
        onClose={() => undefined}
        onEdit={() => undefined}
        onDispatch={async () => undefined}
        onAbort={async () => undefined}
        onDelete={async () => undefined}
        onAddComment={onAddComment}
        onMove={async () => undefined}
        onResolveGate={async () => undefined}
        onRevealPath={() => undefined}
      />,
    );

    await user.type(screen.getByPlaceholderText("补充上下文；用 @builder 或 @BUILD 可直接委派…"), "请先读取现有测试");
    await user.click(screen.getByRole("button", { name: "发送评论" }));
    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith("请先读取现有测试"));
    expect((screen.getByPlaceholderText("补充上下文；用 @builder 或 @BUILD 可直接委派…") as HTMLTextAreaElement).value).toBe("");
  });

  it("creates a reusable Squad with an explicit Leader and selected members", async () => {
    const user = userEvent.setup();
    const onCreateSquad = vi.fn(async () => undefined);
    render(
      <AutomationStudioDialog
        catalog={BUILTIN_ORCHESTRATION_CATALOG}
        project={PROJECT}
        squads={[]}
        autopilots={[]}
        autopilotRuns={[]}
        busy={false}
        onClose={() => undefined}
        onCreateSquad={onCreateSquad}
        onUpdateSquad={async () => undefined}
        onDeleteSquad={async () => undefined}
        onCreateAutopilot={async () => undefined}
        onUpdateAutopilot={async () => undefined}
        onDeleteAutopilot={async () => undefined}
        onTriggerAutopilot={async () => undefined}
        onCopy={async () => undefined}
      />,
    );
    await user.type(screen.getByPlaceholderText("例如：交付突击队"), "可复用交付组");
    await user.type(screen.getByPlaceholderText("这个小队擅长完成什么"), "动态规划、实现和验证");
    await user.click(screen.getAllByRole("button", { name: /方案规划师/ })[0] as HTMLButtonElement);
    await user.click(screen.getAllByRole("button", { name: /实现工程师/ }).at(-1) as HTMLButtonElement);
    const createButtons = screen.getAllByRole("button", { name: "创建 Squad" });
    await user.click(createButtons.at(-1) as HTMLButtonElement);
    await waitFor(() => expect(onCreateSquad).toHaveBeenCalledWith(expect.objectContaining({
      name: "可复用交付组",
      leaderAgentId: "planner",
      memberAgentIds: expect.arrayContaining(["builder"]),
    }))); 
  });

  it("creates a Manual Autopilot bound to the visible project and execution target", async () => {
    const user = userEvent.setup();
    const onCreateAutopilot = vi.fn(async () => undefined);
    render(
      <AutomationStudioDialog
        catalog={BUILTIN_ORCHESTRATION_CATALOG}
        project={PROJECT}
        squads={[]}
        autopilots={[]}
        autopilotRuns={[]}
        busy={false}
        onClose={() => undefined}
        onCreateSquad={async () => undefined}
        onUpdateSquad={async () => undefined}
        onDeleteSquad={async () => undefined}
        onCreateAutopilot={onCreateAutopilot}
        onUpdateAutopilot={async () => undefined}
        onDeleteAutopilot={async () => undefined}
        onTriggerAutopilot={async () => undefined}
        onCopy={async () => undefined}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Autopilot" }));
    await user.type(screen.getByPlaceholderText("例如：手动发布检查"), "发布前复核");
    await user.type(screen.getByPlaceholderText("每次运行生成的新任务标题"), "检查发布候选版本");
    await user.type(screen.getByPlaceholderText("Agent 每次都会收到的固定上下文"), "检查当前工作区变更");
    await user.type(screen.getByPlaceholderText("如何判断这一票完成"), "测试通过并给出报告");
    await user.selectOptions(screen.getByLabelText("执行目标"), "agent:tester");
    await user.click(screen.getByRole("button", { name: "创建规则" }));

    await waitFor(() => expect(onCreateAutopilot).toHaveBeenCalledWith(expect.objectContaining({
      name: "发布前复核",
      trigger: { kind: "manual" },
      projectPath: PROJECT.cwd,
      executionTarget: { kind: "agent", agentId: "tester" },
      taskTemplate: expect.objectContaining({ title: "检查发布候选版本" }),
    })));
  });

  it("shows and copies the complete listening Webhook URL", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn(async () => undefined);
    render(
      <AutomationStudioDialog
        catalog={BUILTIN_ORCHESTRATION_CATALOG}
        project={PROJECT}
        squads={[]}
        autopilots={[WEBHOOK_AUTOPILOT]}
        autopilotRuns={[]}
        webhookStatus={{ state: "listening", host: "127.0.0.1", port: 43199 }}
        busy={false}
        onClose={() => undefined}
        onCreateSquad={async () => undefined}
        onUpdateSquad={async () => undefined}
        onDeleteSquad={async () => undefined}
        onCreateAutopilot={async () => undefined}
        onUpdateAutopilot={async () => undefined}
        onDeleteAutopilot={async () => undefined}
        onTriggerAutopilot={async () => undefined}
        onCopy={onCopy}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Autopilot" }));
    expect(screen.getByText("LISTENING")).toBeTruthy();
    expect(screen.getByText(/127\.0\.0\.1:43199\/api\/webhooks\/visible-random-token/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "复制 Webhook URL" }));
    await waitFor(() => expect(onCopy).toHaveBeenCalledWith("http://127.0.0.1:43199/api/webhooks/visible-random-token"));
  });
});

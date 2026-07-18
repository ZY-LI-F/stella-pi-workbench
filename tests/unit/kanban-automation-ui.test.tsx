import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import type { AgentTask, Autopilot, KanbanTask } from "../../src/shared/kanban";
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
  stage: "planned",
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

const BUILDER = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
if (!BUILDER) throw new Error("测试目录缺少 builder");
const REPORTED_AGENT_TASK: AgentTask = Object.freeze({
  id: "agent-reported",
  taskId: TASK.id,
  agentSnapshot: BUILDER,
  kind: "direct",
  status: "reported",
  acceptance: "pending",
  prompt: "执行任务",
  output: "已报告结果",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:01:00.000Z",
  startedAt: "2026-07-18T00:00:00.000Z",
  completedAt: "2026-07-18T00:01:00.000Z",
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

  it("opens a Pi-sourced task as an editable draft and preserves its source identity on save", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn(async () => undefined);
    render(
      <TaskEditorDialog
        draft={{
          title: "来自 Pi 的任务",
          description: "仍可编辑的上下文",
          acceptanceCriteria: "由用户补充",
          priority: "medium",
          sourcePiSessionPath: "C:/sessions/source.jsonl",
          sourcePiSessionId: "source-session",
        }}
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

    expect((screen.getByPlaceholderText("清楚描述要交付的结果") as HTMLInputElement).value).toBe("来自 Pi 的任务");
    expect(screen.getByText("保存后只创建待规划任务，不会自动分发。来源 session identity 将随任务保存。")).toBeTruthy();
    await user.clear(screen.getByPlaceholderText("清楚描述要交付的结果"));
    await user.type(screen.getByPlaceholderText("清楚描述要交付的结果"), "用户确认后的任务");
    await user.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: "用户确认后的任务",
      sourcePiSessionPath: "C:/sessions/source.jsonl",
      sourcePiSessionId: "source-session",
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
        executionEnabled={true}
        onClose={() => undefined}
        onEdit={() => undefined}
        onDispatch={async () => undefined}
        onAbort={async () => undefined}
        onDelete={async () => undefined}
        onAddComment={onAddComment}
        onMove={async () => undefined}
        onResolveGate={async () => undefined}
        onReviewExecution={async () => undefined}
        onRevealPath={() => undefined}
        onContinueInPi={async () => undefined}
      />,
    );

    await user.type(screen.getByPlaceholderText("补充上下文；用 @builder 或 @BUILD 可直接委派…"), "请先读取现有测试");
    await user.click(screen.getByRole("button", { name: "发送评论" }));
    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith("请先读取现有测试"));
    expect((screen.getByPlaceholderText("补充上下文；用 @builder 或 @BUILD 可直接委派…") as HTMLTextAreaElement).value).toBe("");
  });

  it("previews every AgentTask side effect before an @mention message is submitted", async () => {
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
        executionEnabled={true}
        onClose={() => undefined}
        onEdit={() => undefined}
        onDispatch={async () => undefined}
        onAbort={async () => undefined}
        onDelete={async () => undefined}
        onAddComment={onAddComment}
        onMove={async () => undefined}
        onResolveGate={async () => undefined}
        onReviewExecution={async () => undefined}
        onRevealPath={() => undefined}
        onContinueInPi={async () => undefined}
      />,
    );

    await user.type(screen.getByPlaceholderText("补充上下文；用 @builder 或 @BUILD 可直接委派…"), "@builder 实现后交给 @VERIFY 验证");
    expect(screen.getByRole("status").textContent).toContain("提交后将创建 2 个 AgentTask");
    expect(screen.getByRole("status").textContent).toContain("实现工程师 (@builder)");
    expect(screen.getByRole("status").textContent).toContain("验证工程师 (@tester)");
    expect(onAddComment).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "发送评论" }));
    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith("@builder 实现后交给 @VERIFY 验证"));
  });

  it("continues only the explicitly selected task source session in Pi", async () => {
    const user = userEvent.setup();
    const onContinueInPi = vi.fn(async () => undefined);
    render(
      <TaskDetailPanel
        task={{ ...TASK, sourcePiSessionPath: "C:/sessions/source.jsonl", sourcePiSessionId: "source" }}
        catalog={BUILTIN_ORCHESTRATION_CATALOG}
        squads={[]}
        runs={[]}
        agentTasks={[]}
        comments={[]}
        activities={[]}
        busy={false}
        executionEnabled={true}
        onClose={() => undefined}
        onEdit={() => undefined}
        onDispatch={async () => undefined}
        onAbort={async () => undefined}
        onDelete={async () => undefined}
        onAddComment={async () => undefined}
        onMove={async () => undefined}
        onResolveGate={async () => undefined}
        onReviewExecution={async () => undefined}
        onRevealPath={() => undefined}
        onContinueInPi={onContinueInPi}
      />,
    );

    await user.click(screen.getByRole("button", { name: "在 Pi 中继续" }));
    await waitFor(() => expect(onContinueInPi).toHaveBeenCalledWith("C:/sessions/source.jsonl"));
  });

  it("requires a reason and sends an explicit revision decision for a reported execution", async () => {
    const user = userEvent.setup();
    const onReviewExecution = vi.fn(async () => undefined);
    render(
      <TaskDetailPanel
        task={TASK}
        catalog={BUILTIN_ORCHESTRATION_CATALOG}
        squads={[]}
        runs={[]}
        agentTasks={[REPORTED_AGENT_TASK]}
        comments={[]}
        activities={[]}
        busy={false}
        executionEnabled={true}
        onClose={() => undefined}
        onEdit={() => undefined}
        onDispatch={async () => undefined}
        onAbort={async () => undefined}
        onDelete={async () => undefined}
        onAddComment={async () => undefined}
        onMove={async () => undefined}
        onResolveGate={async () => undefined}
        onReviewExecution={onReviewExecution}
        onRevealPath={() => undefined}
        onContinueInPi={async () => undefined}
      />,
    );

    expect(screen.getByText("执行 · 已报告")).toBeTruthy();
    expect(screen.getByText("验收 · 待验收")).toBeTruthy();
    const revision = screen.getByRole("button", { name: "请求修订" }) as HTMLButtonElement;
    expect(revision.disabled).toBe(true);
    await user.type(screen.getByPlaceholderText("接受可选填说明；请求修订或拒绝必须填写理由"), "补充安装验证");
    expect(revision.disabled).toBe(false);
    await user.click(revision);
    await waitFor(() => expect(onReviewExecution).toHaveBeenCalledWith({
      taskId: TASK.id,
      executionKind: "agent-task",
      executionId: REPORTED_AGENT_TASK.id,
      decision: "revision-requested",
      comment: "补充安装验证",
    }));
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

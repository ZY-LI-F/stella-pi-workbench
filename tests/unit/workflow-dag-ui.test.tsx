import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDefinition, WorkflowRun } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { WorkflowDag } from "../../src/renderer/src/features/kanban/WorkflowDag";

afterEach(() => cleanup());

const AGENT = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "builder");
if (!AGENT) throw new Error("测试目录缺少 builder");
const WORKFLOW: WorkflowDefinition = Object.freeze({
  id: "dag-workflow", version: 1, name: "DAG 测试流程", shortName: "DAG", summary: "测试", teamId: "test",
  steps: Object.freeze([
    Object.freeze({ kind: "agent", id: "build", name: "实现", summary: "完成实现", agentId: AGENT.id, objective: "交付代码" }),
    Object.freeze({ kind: "human-gate", id: "accept", name: "验收", summary: "人工验收", instructions: "核对报告" }),
  ]),
});
const RUN: WorkflowRun = Object.freeze({
  id: "run-ui-dag", taskId: "task-1", workflow: WORKFLOW, agents: Object.freeze([AGENT]), status: "failed", acceptance: "not-ready",
  steps: Object.freeze([
    Object.freeze({ id: "step-build", stepId: "build", stepKind: "agent", name: "实现", status: "succeeded", artifact: Object.freeze({ title: "实现产物", content: "完成" }), sessionPath: "C:/sessions/build.jsonl", startedAt: "2026-07-18T00:00:00.000Z", completedAt: "2026-07-18T00:01:00.000Z" }),
    Object.freeze({ id: "step-accept", stepId: "accept", stepKind: "human-gate", name: "验收", status: "failed", error: "验收未通过", startedAt: "2026-07-18T00:01:00.000Z", completedAt: "2026-07-18T00:02:00.000Z" }),
  ]),
  startedAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:02:00.000Z",
});

describe("WorkflowDag", () => {
  it("renders snapshot nodes and edges, then reveals persisted node detail by mouse and keyboard", async () => {
    const user = userEvent.setup();
    const onContinueInPi = vi.fn(async () => undefined);
    const { container } = render(
      <WorkflowDag workflowExpected runs={[RUN]} busy={false} executionEnabled onRevealPath={() => undefined} onContinueInPi={onContinueInPi} onError={() => undefined} />,
    );

    expect(screen.getByRole("group", { name: "DAG 测试流程 的步骤依赖" })).toBeTruthy();
    expect(container.querySelectorAll(".workflow-dag-node")).toHaveLength(2);
    expect(container.querySelectorAll(".workflow-dag-edge")).toHaveLength(1);
    expect(screen.getByText("实现产物")).toBeTruthy();

    const build = screen.getByRole("button", { name: "实现，已产出" });
    build.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "验收，执行失败" }));
    expect(screen.getByText("验收未通过")).toBeTruthy();

    await user.click(build);
    await user.click(screen.getByRole("button", { name: "在 Pi 中继续" }));
    expect(onContinueInPi).toHaveBeenCalledWith("C:/sessions/build.jsonl");
  });

  it("shows explicit empty states for non-Workflow tasks and missing persisted runs", () => {
    const props = { busy: false, executionEnabled: true, onRevealPath: () => undefined, onContinueInPi: async () => undefined, onError: () => undefined };
    const { rerender } = render(<WorkflowDag {...props} workflowExpected={false} runs={[]} />);
    expect(screen.getByText("当前任务不是 Workflow")).toBeTruthy();
    rerender(<WorkflowDag {...props} workflowExpected runs={[]} />);
    expect(screen.getByText("尚无持久化 Run")).toBeTruthy();
  });
});

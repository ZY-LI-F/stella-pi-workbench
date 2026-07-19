import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { TeamLaunchRoom } from "../../src/renderer/src/features/team/TeamLaunchRoom";

afterEach(() => cleanup());

const PROJECT = Object.freeze({
  cwd: "C:/project",
  name: "project",
  branch: "main",
  trusted: true,
  requiresTrust: false,
});
const LEAD = BUILTIN_ORCHESTRATION_CATALOG.agents.find((agent) => agent.id === "lead");
if (!LEAD) throw new Error("测试目录缺少 LEAD");

describe("TeamLaunchRoom", () => {
  it("selects LEAD from the visible roster, previews the new task, and submits one launch message", async () => {
    const user = userEvent.setup();
    const onLaunch = vi.fn(async () => undefined);
    render(<TeamLaunchRoom project={PROJECT} lead={LEAD} presences={[]} busy={false} executionEnabled onLaunch={onLaunch} />);

    const composer = screen.getByPlaceholderText("@LEAD 说明目标、边界和希望得到的结果…") as HTMLTextAreaElement;
    await user.type(composer, "@le");
    expect(screen.getByRole("listbox", { name: "选择要 @ 的 Agent" })).toBeTruthy();
    await user.keyboard("{Enter}");
    await user.type(composer, "评估 NLRP3 靶点并形成可审计报告");
    expect(screen.getByRole("status").textContent).toContain("将创建任务“评估 NLRP3 靶点并形成可审计报告”");
    await user.click(screen.getByRole("button", { name: "创建任务并交给 LEAD" }));

    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith("@LEAD 评估 NLRP3 靶点并形成可审计报告"));
    expect(composer.value).toBe("");
  });

  it("accepts a Team Pulse LEAD request and blocks direct Worker instructions", async () => {
    const { rerender } = render(<TeamLaunchRoom project={PROJECT} lead={LEAD} presences={[]} busy={false} executionEnabled onLaunch={async () => undefined} />);
    const composer = screen.getByPlaceholderText("@LEAD 说明目标、边界和希望得到的结果…") as HTMLTextAreaElement;
    rerender(<TeamLaunchRoom project={PROJECT} lead={LEAD} presences={[]} mentionRequest={{ requestId: 1, agentId: "lead" }} busy={false} executionEnabled onLaunch={async () => undefined} />);
    await waitFor(() => expect(composer.value).toBe("@LEAD "));

    const user = userEvent.setup();
    await user.clear(composer);
    await user.type(composer, "@BUILD 直接修改项目");
    expect(screen.getByRole("alert").textContent).toContain("项目启动室只接受 @LEAD");
    expect((screen.getByRole("button", { name: "创建任务并交给 LEAD" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

import { expect, test, _electron as electron } from "@playwright/test";
import { createServer } from "node:net";

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法为 Electron E2E 分配本机 Webhook 端口");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test("launches the real Pi RPC workbench and exposes core controls", async ({}, testInfo) => {
  const webhookPort = await availableLoopbackPort();
  const electronApp = await electron.launch({
    args: [".", `--user-data-dir=${testInfo.outputPath("electron-user-data")}`],
    cwd: process.cwd(),
    env: Object.freeze({ ...process.env, STELLA_WEBHOOK_PORT: String(webhookPort) }),
  });
  try {
    const window = await electronApp.firstWindow();
    const pageErrors: string[] = [];
    window.on("pageerror", (error) => pageErrors.push(error.message));

    await window.waitForLoadState("domcontentloaded");
    expect(await window.evaluate(() => typeof window.stella)).toBe("object");
    await expect(window.locator(".app-shell, .startup-screen--error")).toBeVisible({ timeout: 45_000 });

    const startupError = window.locator(".startup-screen--error");
    if (await startupError.isVisible()) {
      throw new Error(`Stella failed to initialize:\n${await startupError.innerText()}`);
    }

    await expect(window.getByLabel(/Stella Pi Workbench/).first()).toBeVisible();
    await expect(window.getByRole("button", { name: "新建看板任务" })).toBeVisible();
    await expect(window.getByRole("heading", { name: "任务星图" })).toBeVisible();
    const globalModel = window.getByRole("combobox", { name: "全局模型" });
    await expect(globalModel).toBeVisible();
    await expect(window.getByLabel("全局运行模型")).toContainText("当前模型");
    await expect(window.getByText("Stella", { exact: true }).first()).toBeVisible();
    await expect(window.getByLabel("最小化")).toBeVisible();
    await window.bringToFront();

    await window.getByRole("button", { name: "新建任务", exact: true }).click();
    const taskDialog = window.getByRole("dialog", { name: "创建看板任务" });
    await expect(taskDialog).toBeVisible();
    await taskDialog.getByLabel(/任务标题/).fill("验证固定 Agent 看板");
    await taskDialog.getByLabel("任务说明").fill("确认任务卡片、拖放和编排目录交互。");
    await taskDialog.getByLabel("验收标准").fill("任务能在看板中持久化并显示流程星轨。");
    await taskDialog.getByRole("button", { name: /代码审阅/ }).click();
    await taskDialog.getByRole("button", { name: "创建任务", exact: true }).click();
    const taskCard = window.locator(".kanban-card", { hasText: "验证固定 Agent 看板" });
    await expect(taskCard).toBeVisible();

    await taskCard.getByRole("button", { name: "验证固定 Agent 看板", exact: true }).click();
    const taskRoom = window.getByLabel("任务详情：验证固定 Agent 看板");
    await expect(taskRoom.getByText("任务事实流", { exact: true })).toBeVisible();
    await expect(taskRoom.getByText("尚无持久化 Run", { exact: true })).toBeVisible();
    const roomComposer = taskRoom.getByPlaceholder("补充上下文；输入 @ 选择 Agent，或直接发送普通消息…");
    await roomComposer.fill("@策略");
    const mentionPicker = taskRoom.getByRole("listbox", { name: "选择要 @ 的 Agent" });
    await expect(mentionPicker.getByRole("option", { name: /靶点策略负责人/ })).toBeVisible();
    await window.screenshot({ path: "docs/agent-mention-picker-stella.png", fullPage: true, animations: "disabled" });
    await mentionPicker.getByRole("option", { name: /靶点策略负责人/ }).click();
    await expect(roomComposer).toHaveValue("@STRATEGY ");
    await roomComposer.fill("@builder 实现后交给 @VERIFY 验证");
    await expect(taskRoom.getByText(/提交后将创建 2 个 AgentTask/)).toBeVisible();
    await window.screenshot({ path: "docs/task-room-stella.png", fullPage: true, animations: "disabled" });
    await taskRoom.getByRole("button", { name: "关闭任务详情" }).click();

    const selectedGlobalModel = await globalModel.inputValue();
    await window.getByRole("button", { name: "团队协作", exact: true }).click();
    await expect(window.getByRole("heading", { name: "团队协作" })).toBeVisible();
    await expect(globalModel).toHaveValue(selectedGlobalModel);
    await expect(window.getByRole("heading", { name: "项目启动室", exact: true })).toBeVisible();
    const launchComposer = window.getByPlaceholder("@LEAD 说明目标、边界和希望得到的结果…");
    await window.getByRole("button", { name: "在项目启动室 @通用调度负责人" }).click();
    await expect(launchComposer).toHaveValue("@LEAD ");
    await launchComposer.fill("@LEAD 调研交互需求，拆解实现与验证任务，并在成员报告后给出验收结论");
    await expect(window.getByText(/将创建任务“调研交互需求，拆解实现与验证任务，并在成员报告后给出验收结论”/)).toBeVisible();
    await expect(window.getByRole("button", { name: "在项目启动室 @实现工程师" })).toBeDisabled();
    await window.screenshot({ path: "docs/team-launch-room-stella.png", fullPage: true, animations: "disabled" });
    await expect(window.getByRole("button", { name: /验证固定 Agent 看板/ })).toBeVisible();
    await window.getByRole("button", { name: /验证固定 Agent 看板/ }).click();
    const teamRoom = window.getByLabel("任务详情：验证固定 Agent 看板");
    const teamComposer = teamRoom.getByPlaceholder("补充上下文；输入 @ 选择 Agent，或直接发送普通消息…");
    await teamComposer.fill("@lead 请拆解任务、委派合适 Worker 并验收结果");
    await expect(teamRoom.getByText(/通用调度负责人 \(@LEAD\)/)).toBeVisible();
    await window.getByRole("button", { name: "创建 Agent", exact: true }).click();
    const agentDraft = window.getByRole("dialog", { name: "创建项目 Agent" });
    await agentDraft.getByLabel(/名称/).fill("数据分析师");
    await agentDraft.getByLabel(/呼号/).fill("DATA");
    await agentDraft.getByLabel(/职责/).fill("分析项目数据并提供可复算证据。");
    await agentDraft.getByLabel(/固定指令/).fill("只读分析；明确输入、计算过程、结论和未验证项。");
    await agentDraft.getByRole("button", { name: "创建 Agent", exact: true }).click();
    await expect(window.locator(".agent-presence", { hasText: "数据分析师" })).toBeVisible();
    await teamComposer.fill("");
    await window.getByRole("button", { name: "在 Task Room @数据分析师" }).click();
    await expect(teamComposer).toHaveValue("@DATA ");
    await window.screenshot({ path: "docs/team-chat-stella.png", fullPage: true, animations: "disabled" });
    await window.getByRole("button", { name: "任务看板", exact: true }).click();
    await expect(window.getByRole("heading", { name: "任务星图" })).toBeVisible();
    await expect(globalModel).toHaveValue(selectedGlobalModel);

    await taskCard.dragTo(window.locator(".kanban-lane--blocked"));
    await expect(window.locator(".kanban-lane--blocked").getByText("验证固定 Agent 看板", { exact: true })).toBeVisible();
    await taskCard.dragTo(window.locator(".kanban-lane--planned"));
    await expect(window.locator(".kanban-lane--planned").getByText("验证固定 Agent 看板", { exact: true })).toBeVisible();

    await window.getByRole("button", { name: "编排目录" }).click();
    const catalog = window.getByRole("dialog", { name: "固定编排目录" });
    await expect(catalog.getByText("项目侦察员", { exact: true })).toBeVisible();
    await catalog.getByRole("tab", { name: "团队" }).click();
    await expect(catalog.getByText("交付小队", { exact: true })).toBeVisible();
    await catalog.getByRole("tab", { name: "流程" }).click();
    await expect(catalog.getByText("功能交付流程", { exact: true })).toBeVisible();
    await window.keyboard.press("Escape");

    await window.getByRole("button", { name: "偏好设置", exact: true }).click();
    let settings = window.getByRole("dialog", { name: "偏好设置" });
    await expect(settings).toBeVisible();
    await settings.getByRole("radio", { name: /^Stella/ }).click();
    await settings.getByRole("button", { name: "星夜" }).click();
    const initialDensitySwitch = settings.getByRole("switch", { name: "紧凑密度" });
    if ((await initialDensitySwitch.getAttribute("aria-checked")) === "true") await initialDensitySwitch.click();
    await window.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(window.locator("html")).toHaveAttribute("data-skin", "stella");
    await window.screenshot({ path: "docs/kanban-stella.png", fullPage: true, animations: "disabled" });

    await window.getByRole("button", { name: "自动化", exact: true }).click();
    let automationStudio = window.getByRole("dialog", { name: "自动化工作室" });
    await automationStudio.getByRole("tab", { name: "Autopilot" }).click();
    await automationStudio.getByRole("tab", { name: "Webhook" }).click();
    await automationStudio.getByLabel("规则名称").fill("本机构建回调");
    await automationStudio.getByLabel("任务标题").fill("处理本机构建回调");
    await automationStudio.getByLabel("任务说明").fill("读取本机脚本传入的 JSON 上下文并执行固定检查。" );
    await automationStudio.getByLabel("验收标准").fill("真实任务已创建并留下可检查产物。" );
    await automationStudio.getByRole("button", { name: "创建规则" }).click();
    await automationStudio.getByRole("button", { name: /本机构建回调/ }).click();
    await expect(automationStudio.getByText("LISTENING")).toBeVisible();
    await expect(automationStudio.getByText(new RegExp(`127\\.0\\.0\\.1:${webhookPort}\\/api\\/webhooks\\/`))).toBeVisible();
    await automationStudio.locator(".autopilot-editor__scroll").evaluate((element) => { element.scrollTop = 0; });
    await window.screenshot({ path: "docs/automation-stella.png", fullPage: true, animations: "disabled" });
    await window.keyboard.press("Escape");
    await expect(automationStudio).toBeHidden();

    await window.keyboard.press("Control+K");
    const palette = window.getByRole("dialog", { name: "搜索与命令" });
    await expect(palette).toBeVisible();
    const paletteInput = palette.getByPlaceholder("搜索操作、技能或提示词…");
    await paletteInput.fill("偏好设置");
    await expect(palette.getByRole("button", { name: /偏好设置/ })).toBeVisible();
    await paletteInput.press("Enter");

    settings = window.getByRole("dialog", { name: "偏好设置" });
    await expect(settings).toBeVisible();
    await window.screenshot({ path: "docs/skin-picker.png", fullPage: true, animations: "disabled" });
    await settings.getByRole("button", { name: "月白" }).click();
    await expect(window.locator("html")).toHaveAttribute("data-theme", "light");
    await settings.getByRole("button", { name: "星夜" }).click();
    await expect(window.locator("html")).toHaveAttribute("data-theme", "dark");
    const densitySwitch = settings.getByRole("switch", { name: "紧凑密度" });
    await densitySwitch.click();
    await expect(window.locator("html")).toHaveAttribute("data-density", "compact");
    await densitySwitch.click();
    await expect(window.locator("html")).toHaveAttribute("data-density", "comfortable");

    await settings.getByRole("radio", { name: /^晨曦/ }).click();
    await expect(window.locator("html")).toHaveAttribute("data-skin", "chenxi");
    await window.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await window.screenshot({ path: "docs/kanban-chenxi.png", fullPage: true, animations: "disabled" });
    await window.getByRole("button", { name: "自动化", exact: true }).click();
    automationStudio = window.getByRole("dialog", { name: "自动化工作室" });
    await automationStudio.getByRole("tab", { name: "Autopilot" }).click();
    await window.screenshot({ path: "docs/automation-chenxi.png", fullPage: true, animations: "disabled" });
    await window.keyboard.press("Escape");

    await window.getByRole("button", { name: "偏好设置", exact: true }).click();
    settings = window.getByRole("dialog", { name: "偏好设置" });
    await settings.getByRole("radio", { name: /^定阳/ }).click();
    await expect(window.locator("html")).toHaveAttribute("data-skin", "dingyang");
    await window.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await window.screenshot({ path: "docs/kanban-dingyang.png", fullPage: true, animations: "disabled" });
    await window.getByRole("button", { name: "自动化", exact: true }).click();
    automationStudio = window.getByRole("dialog", { name: "自动化工作室" });
    await automationStudio.getByRole("tab", { name: "Autopilot" }).click();
    await window.screenshot({ path: "docs/automation-dingyang.png", fullPage: true, animations: "disabled" });
    await window.keyboard.press("Escape");

    await window.getByRole("button", { name: "偏好设置", exact: true }).click();
    settings = window.getByRole("dialog", { name: "偏好设置" });
    await settings.getByRole("radio", { name: /^Stella/ }).click();
    await expect(window.locator("html")).toHaveAttribute("data-skin", "stella");
    await window.keyboard.press("Escape");
    await expect(settings).toBeHidden();

    await window.getByRole("button", { name: "当前会话" }).click();
    await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
    await expect(globalModel).toHaveValue(selectedGlobalModel);
    await expect(window.getByLabel("思考级别")).toBeVisible();
    await window.getByRole("button", { name: "固化为任务" }).click();
    const piTaskDraft = window.getByRole("dialog", { name: "创建看板任务" });
    await expect(piTaskDraft.getByText("来自当前 Pi 会话的可编辑草稿", { exact: true })).toBeVisible();
    await expect(piTaskDraft.getByText(/不会自动分发/)).toBeVisible();
    await piTaskDraft.getByRole("button", { name: "取消", exact: true }).click();
    await window.getByRole("button", { name: "当前会话" }).click();
    await window.screenshot({ path: "docs/stella-home.png", fullPage: true, animations: "disabled" });

    const inspector = window.locator(".inspector.is-open");
    await inspector.getByRole("button", { name: "活动", exact: true }).click();
    await expect(inspector.getByText("活动轨迹", { exact: true })).toBeVisible();
    await inspector.getByRole("button", { name: "分支", exact: true }).click();
    await expect(inspector.getByText(/会话是追加式树结构/)).toBeVisible();
    await inspector.getByRole("button", { name: "上下文", exact: true }).click();
    await inspector.getByRole("button", { name: /重命名/ }).click();
    const renameDialog = window.getByRole("dialog", { name: "重命名会话" });
    await expect(renameDialog).toBeVisible();
    await window.keyboard.press("Escape");
    await expect(renameDialog).toBeHidden();

    await window.getByRole("button", { name: "运行命令", exact: true }).first().click();
    const terminal = window.locator(".terminal-drawer.is-open");
    await expect(terminal).toBeVisible();
    const terminalInput = terminal.getByPlaceholder("输入 PowerShell / shell 命令…");
    await terminalInput.fill("echo stella-interaction-check");
    await expect(terminalInput).toHaveValue("echo stella-interaction-check");
    await terminal.getByRole("button", { name: "关闭终端" }).click();
    await expect(terminal).toBeHidden();

    const composer = window.getByLabel("给 Pi 的消息");
    await window.getByRole("button", { name: "理解项目" }).click();
    await expect(composer).toHaveValue(/先阅读这个项目/);
    await composer.fill("");
    await window.locator('.composer input[type="file"]').setInputFiles({
      name: "stella-pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
    });
    await expect(window.getByAltText("stella-pixel.png")).toBeVisible();
    await window.getByRole("button", { name: "移除 stella-pixel.png" }).click();
    await expect(window.getByAltText("stella-pixel.png")).toBeHidden();

    await inspector.getByRole("button", { name: "关闭检查器" }).click();
    await window.setViewportSize({ width: 1_000, height: 760 });
    await expect(window.getByLabel("打开侧栏")).toBeVisible();
    const responsiveSidebar = window.locator(".sidebar");
    await expect
      .poll(() => responsiveSidebar.evaluate((element) => element.getBoundingClientRect().right))
      .toBeLessThanOrEqual(1);
    await window.getByLabel("打开侧栏").click();
    await expect(responsiveSidebar).toHaveClass(/is-open/);
    await responsiveSidebar.getByRole("button", { name: "偏好设置", exact: true }).click();
    await expect(window.getByRole("dialog", { name: "偏好设置" })).toBeVisible();
    await expect(responsiveSidebar).not.toHaveClass(/is-open/);
    await window.keyboard.press("Escape");

    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

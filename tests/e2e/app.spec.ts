import { expect, test, _electron as electron } from "@playwright/test";

test("launches the real Pi RPC workbench and exposes core controls", async () => {
  const electronApp = await electron.launch({
    args: ["."],
    cwd: process.cwd(),
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
    await expect(window.getByRole("button", { name: "新建任务" })).toBeVisible();
    await expect(window.getByLabel("给 Pi 的消息")).toBeVisible();
    await expect(window.getByText("Stella", { exact: true }).first()).toBeVisible();
    await expect(window.getByLabel("模型")).toBeVisible();
    await expect(window.getByLabel("思考级别")).toBeVisible();
    await expect(window.getByLabel("最小化")).toBeVisible();
    await window.bringToFront();

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
    await window.screenshot({ path: "docs/stella-home.png", fullPage: true, animations: "disabled" });

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
    await window.screenshot({ path: "docs/chenxi-home.png", fullPage: true, animations: "disabled" });

    await window.getByRole("button", { name: "偏好设置", exact: true }).click();
    settings = window.getByRole("dialog", { name: "偏好设置" });
    await settings.getByRole("radio", { name: /^定阳/ }).click();
    await expect(window.locator("html")).toHaveAttribute("data-skin", "dingyang");
    await window.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await window.screenshot({ path: "docs/dingyang-home.png", fullPage: true, animations: "disabled" });

    await window.getByRole("button", { name: "偏好设置", exact: true }).click();
    settings = window.getByRole("dialog", { name: "偏好设置" });
    await settings.getByRole("radio", { name: /^Stella/ }).click();
    await expect(window.locator("html")).toHaveAttribute("data-skin", "stella");
    await window.keyboard.press("Escape");
    await expect(settings).toBeHidden();

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
    await window.locator(".sidebar-scrim").click();
    await expect(responsiveSidebar).not.toHaveClass(/is-open/);

    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

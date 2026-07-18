import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { APP_ROOT, createNlrp3Task, launchPharmaApp } from "./helpers/pharma-app";

test("creates an NLRP3 assessment from the trusted project through the real Electron UI", async ({}, testInfo) => {
  const { electronApp, window } = await launchPharmaApp(testInfo);
  const pageErrors: string[] = [];
  window.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await window.keyboard.press("Control+K");
    const palette = window.getByRole("dialog", { name: "搜索与命令" });
    const search = palette.getByPlaceholder("搜索操作、技能或提示词…");
    await search.fill("target-evidence");
    await expect(palette.getByRole("button", { name: /skill:target-evidence/ })).toBeVisible();
    await expect(palette.getByText("skill", { exact: true })).toBeVisible();
    await window.keyboard.press("Escape");

    await window.getByRole("button", { name: "编排目录" }).click();
    const catalog = window.getByRole("dialog", { name: "固定编排目录" });
    await expect(catalog.getByText("靶点生物学研究员", { exact: true })).toBeVisible();
    await expect(catalog.getByLabel("靶点生物学研究员 必需 Skills")).toContainText("skill:target-evidence");
    await catalog.getByRole("tab", { name: "团队" }).click();
    await expect(catalog.getByText("早研靶评小队", { exact: true })).toBeVisible();
    await catalog.getByRole("tab", { name: "流程" }).click();
    await expect(catalog.getByText("早研靶点评估流程", { exact: true })).toBeVisible();
    await expect(catalog.getByText("证据范围确认", { exact: true })).toBeVisible();
    await window.keyboard.press("Escape");

    const taskCard = await createNlrp3Task(window);
    await taskCard.getByRole("button", { name: "NLRP3 早研靶点评估", exact: true }).click();
    const taskRoom = window.getByLabel("任务详情：NLRP3 早研靶点评估");
    await expect(taskRoom.getByText("早研靶评", { exact: true })).toBeVisible();
    await expect(taskRoom.getByText("尚无持久化 Run", { exact: true })).toBeVisible();
    await expect(taskRoom.getByRole("button", { name: "开始执行" })).toBeEnabled();
    await window.setViewportSize({ width: 1_600, height: 1_000 });
    await window.screenshot({ path: join(APP_ROOT, "docs", "pharma-e2e-nlrp3.png"), animations: "disabled" });
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

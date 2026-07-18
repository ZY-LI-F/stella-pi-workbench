import { access } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { APP_ROOT, PHARMA_PROJECT, createNlrp3Task, launchPharmaApp } from "./helpers/pharma-app";

test("runs the complete NLRP3 evidence, report, audit, gates, DAG, and acceptance flow", async ({}, testInfo) => {
  const { electronApp, window } = await launchPharmaApp(testInfo);
  const pageErrors: string[] = [];
  window.on("pageerror", (error) => pageErrors.push(error.message));
  const runId = `live-${Date.now()}`;
  try {
    const taskCard = await createNlrp3Task(window, { evidenceRunId: runId });
    await taskCard.getByRole("button", { name: "NLRP3 早研靶点评估", exact: true }).click();
    const taskRoom = window.getByLabel("任务详情：NLRP3 早研靶点评估");
    await taskRoom.getByRole("button", { name: "开始执行" }).click();

    const scopeGate = taskRoom.locator(".human-gate-card", { hasText: "证据范围确认" });
    await expect(scopeGate).toBeVisible({ timeout: 1_200_000 });
    await expect(taskRoom.getByRole("button", { name: /靶点证据，已产出/ })).toBeVisible();
    await expect(taskRoom.getByRole("button", { name: /竞品扫描，已产出/ })).toBeVisible();
    await access(join(PHARMA_PROJECT, "evidence", "e2e", `${runId}-target.json`));
    await access(join(PHARMA_PROJECT, "evidence", "e2e", `${runId}-clinical.json`));
    await scopeGate.getByPlaceholder(/填写批准说明/).fill("身份、纳排规则、失败项目和快照日期已核对，批准进入评分。" );
    await window.setViewportSize({ width: 1_600, height: 1_000 });
    await window.screenshot({ path: join(APP_ROOT, "docs", "pharma-e2e-nlrp3-evidence-gate.png"), animations: "disabled" });
    await scopeGate.getByRole("button", { name: "批准并继续" }).click();

    const finalGate = taskRoom.locator(".human-gate-card", { hasText: "组合评审" });
    await expect(finalGate).toBeVisible({ timeout: 1_200_000 });
    await expect(taskRoom.getByRole("button", { name: /决策报告，已产出/ })).toBeVisible();
    await expect(taskRoom.getByRole("button", { name: /证据审计，已产出/ })).toBeVisible();
    const reportArtifact = taskRoom.locator("details.artifact-card").filter({ hasText: "决策报告 · Agent 产物" }).last();
    await reportArtifact.locator("summary").click();
    await expect(reportArtifact.locator(".artifact-markdown")).toContainText(/加权|总评分|评分卡/);
    await expect(reportArtifact.locator(".artifact-markdown")).toContainText(/NCT0/);
    const auditArtifact = taskRoom.locator("details.artifact-card").filter({ hasText: "证据审计 · Agent 产物" }).last();
    await auditArtifact.locator("summary").click();
    await expect(auditArtifact.locator(".artifact-markdown")).toContainText(/审计|复算|发现/);
    await finalGate.getByPlaceholder(/填写批准说明/).fill("报告与独立审计均已阅读，按证据快照边界接受。" );
    await finalGate.getByRole("button", { name: "批准并继续" }).click();

    const acceptance = taskRoom.locator(".execution-review-card", { hasText: "验收本次执行报告" });
    await expect(acceptance).toBeVisible({ timeout: 60_000 });
    await acceptance.getByPlaceholder(/接受可选填说明/).fill("接受 NLRP3 靶点评估报告及其 HOLD 边界。" );
    await acceptance.getByRole("button", { name: "接受报告" }).click();
    await expect(taskRoom.getByText("验收 · 已接受", { exact: true })).toBeVisible();
    await window.screenshot({ path: join(APP_ROOT, "docs", "pharma-e2e-nlrp3-live.png"), animations: "disabled" });
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
  }
});

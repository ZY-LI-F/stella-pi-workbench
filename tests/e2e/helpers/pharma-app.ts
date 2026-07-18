import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, _electron as electron, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";

export const APP_ROOT = resolve(process.cwd());
export const PHARMA_PROJECT = join(APP_ROOT, "examples", "pharma-early-research");

export async function launchPharmaApp(testInfo: TestInfo): Promise<{ readonly electronApp: ElectronApplication; readonly window: Page }> {
  const userData = testInfo.outputPath("electron-user-data");
  await mkdir(userData, { recursive: true });
  await writeFile(join(userData, "stella-state.json"), `${JSON.stringify({
    lastProject: PHARMA_PROJECT,
    recentProjects: [{ path: PHARMA_PROJECT, trusted: true, lastOpened: "2026-07-18T00:00:00.000Z" }],
  }, null, 2)}\n`, "utf8");

  const electronApp = await electron.launch({
    args: [APP_ROOT, `--user-data-dir=${userData}`],
    cwd: PHARMA_PROJECT,
  });
  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await expect(window.locator(".app-shell, .startup-screen--error")).toBeVisible({ timeout: 45_000 });
  const startupError = window.locator(".startup-screen--error");
  if (await startupError.isVisible()) throw new Error(`Stella failed to initialize:\n${await startupError.innerText()}`);
  await expect(window.getByRole("heading", { name: "任务星图" })).toBeVisible();
  const deadline = Date.now() + 60_000;
  let health = await window.evaluate(() => window.stella.capabilities());
  while (health.pi.state !== "ready" && health.pi.state !== "error" && Date.now() < deadline) {
    await window.waitForTimeout(250);
    health = await window.evaluate(() => window.stella.capabilities());
  }
  if (health.pi.state !== "ready") throw new Error(`Pi capability ${health.pi.state}: ${health.pi.error ?? "unknown error"}`);
  return Object.freeze({ electronApp, window });
}

interface Nlrp3TaskOptions {
  readonly evidenceRunId?: string;
}

export async function createNlrp3Task(window: Page, options: Nlrp3TaskOptions = {}) {
  const evidencePaths = options.evidenceRunId
    ? `本次运行必须新建 evidence/e2e/${options.evidenceRunId}-target.json 与 evidence/e2e/${options.evidenceRunId}-clinical.json，不得把已有快照当作本次采集成功。`
    : "原始证据保存到带快照日期的 JSON 文件。";
  await window.getByRole("button", { name: "新建任务", exact: true }).click();
  const dialog = window.getByRole("dialog", { name: "创建看板任务" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/任务标题/).fill("NLRP3 早研靶点评估");
  await dialog.getByLabel("任务说明").fill([
    "靶点 NLRP3（ENSG00000162711，Homo sapiens）。",
    "评估口服、脑穿透、选择性小分子抑制剂用于早期帕金森病炎症富集人群的立项价值。",
    "竞争范围只纳入直接 NLRP3 抑制的人体干预试验；观察性和下游通路项目单列。",
    "保留证据快照日期、NCT ID、状态更新时间、终止/撤回项目和所有原始来源。",
    evidencePaths,
  ].join("\n"));
  await dialog.getByLabel("验收标准").fill([
    "覆盖 Open Targets、HPA、ChEMBL、ClinicalTrials.gov；",
    "报告含人类验证、机制、成药性、安全、标志物、竞品、评分、反证、90 天计划和来源台账；",
    "证据审计独立复算并指出会改变结论的问题。",
  ].join("\n"));
  await dialog.getByRole("button", { name: /早研靶评/ }).click();
  await dialog.getByRole("button", { name: "创建任务", exact: true }).click();
  const card = window.locator(".kanban-card", { hasText: "NLRP3 早研靶点评估" });
  await expect(card).toBeVisible();
  return card;
}

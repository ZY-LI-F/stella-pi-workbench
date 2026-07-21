import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function availableLoopbackPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("无法分配本机端口");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

test("reveals the configured API key on demand and runs a real isolated model probe", async ({}, testInfo) => {
  let receivedAuthorization = "";
  const providerServer = createServer(async (request, response) => {
    receivedAuthorization = request.headers.authorization ?? "";
    for await (const _chunk of request) {
      // Drain the request before writing the deterministic local SSE response.
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end([
      `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", created: 1, model: "stella-e2e-model", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}`,
      "",
      `data: ${JSON.stringify({ id: "chatcmpl-e2e", object: "chat.completion.chunk", created: 1, model: "stella-e2e-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
      "",
      "data: [DONE]",
      "",
    ].join("\n"));
  });
  await new Promise<void>((resolve, reject) => {
    providerServer.once("error", reject);
    providerServer.listen(0, "127.0.0.1", resolve);
  });
  const providerAddress = providerServer.address();
  if (!providerAddress || typeof providerAddress === "string") throw new Error("无法创建本机 Provider");

  const agentDir = await mkdtemp(join(tmpdir(), "stella-model-e2e-"));
  await writeFile(join(agentDir, "models.json"), JSON.stringify({
    providers: {
      "stella-e2e": {
        name: "OpenAI-Compatible Local",
        baseUrl: `http://127.0.0.1:${providerAddress.port}/v1`,
        api: "openai-completions",
        models: [{
          id: "stella-e2e-model",
          name: "Local Validation Model",
          reasoning: false,
          input: ["text"],
          contextWindow: 8_192,
          maxTokens: 1_024,
        }],
      },
    },
  }), "utf8");
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({
    "stella-e2e": { type: "api_key", key: "stella-e2e-secret" },
  }), "utf8");

  const electronApp = await electron.launch({
    args: [".", `--user-data-dir=${testInfo.outputPath("electron-user-data")}`],
    cwd: process.cwd(),
    env: Object.freeze({
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      STELLA_WEBHOOK_PORT: String(await availableLoopbackPort()),
    }),
  });

  try {
    const window = await electronApp.firstWindow();
    const pageErrors: string[] = [];
    window.on("pageerror", (error) => pageErrors.push(error.message));
    await window.waitForLoadState("domcontentloaded");
    await expect(window.locator(".app-shell, .startup-screen--error")).toBeVisible({ timeout: 45_000 });
    if (await window.locator(".startup-screen--error").isVisible()) {
      throw new Error(await window.locator(".startup-screen--error").innerText());
    }

    await window.getByRole("button", { name: "模型配置", exact: true }).click();
    await expect(window.getByRole("heading", { name: "模型配置", exact: true })).toBeVisible({ timeout: 30_000 });
    const providerList = window.getByLabel("Provider 列表");
    await providerList.getByRole("button", { name: /OpenAI-Compatible Local/ }).click();

    const currentKey = window.getByLabel("OpenAI-Compatible Local 当前 API key");
    await expect(currentKey).toHaveValue("");
    await expect(currentKey).toHaveAttribute("placeholder", /点击查看/);
    await window.getByRole("button", { name: "查看当前 API key" }).click();
    await expect(currentKey).toHaveValue("stella-e2e-secret");
    await window.getByRole("button", { name: "隐藏当前 API key" }).click();
    await expect(currentKey).toHaveValue("");

    await window.getByRole("button", { name: "测试 OpenAI-Compatible Local 连通性" }).click();
    await expect(window.getByText("连通已验证")).toBeVisible({ timeout: 30_000 });
    await expect(window.getByLabel("OpenAI-Compatible Local 连通测试")).toContainText("stella-e2e-model");
    expect(receivedAuthorization).toBe("Bearer stella-e2e-secret");

    const closeNotice = window.getByRole("button", { name: "关闭通知" });
    if (await closeNotice.isVisible()) await closeNotice.click();
    await window.setViewportSize({ width: 1_850, height: 1_178 });
    await window.screenshot({ path: "docs/model-configuration-stella.png", fullPage: true, animations: "disabled" });
    await window.setViewportSize({ width: 600, height: 900 });
    const providerConsole = window.locator(".provider-console");
    await expect.poll(() => window.locator(".provider-saved-key").evaluate((element) => getComputedStyle(element).display)).toBe("grid");
    await expect.poll(() => providerConsole.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await window.screenshot({ path: testInfo.outputPath("model-configuration.png"), fullPage: true, animations: "disabled" });
    await providerConsole.screenshot({ path: testInfo.outputPath("model-configuration-console.png"), animations: "disabled" });
    expect(pageErrors).toEqual([]);
  } finally {
    await electronApp.close();
    await new Promise<void>((resolve, reject) => providerServer.close((error) => error ? reject(error) : resolve()));
    await rm(agentDir, { recursive: true, force: true });
  }
});

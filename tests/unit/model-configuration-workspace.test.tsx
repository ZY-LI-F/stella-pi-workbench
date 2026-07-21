import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSummary, RuntimeBootstrap, StellaDesktopApi } from "../../src/shared/contracts";
import type { PiApiKeyRevealResult, PiModelConfigurationSnapshot, PiModelConnectionTestResult } from "../../src/shared/model-configuration";
import { ModelConfigurationWorkspace } from "../../src/renderer/src/features/models/ModelConfigurationWorkspace";

const MODELS: readonly ModelSummary[] = Object.freeze([
  Object.freeze({ provider: "openai", id: "gpt-5.6-sol", name: "GPT-5.6 Sol", contextWindow: 272_000, reasoning: true }),
  Object.freeze({ provider: "openai", id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1_000_000, reasoning: false }),
]);

const SNAPSHOT: PiModelConfigurationSnapshot = Object.freeze({
  agentDir: "C:/pi-agent",
  modelsPath: "C:/pi-agent/models.json",
  authPath: "C:/pi-agent/auth.json",
  providers: Object.freeze([
    Object.freeze({
      id: "openai",
      name: "OpenAI",
      builtIn: true,
      hasCustomConfiguration: false,
      configured: true,
      authSource: "environment",
      authLabel: "OPENAI_API_KEY",
      supportsApiKey: true,
      supportsOAuth: false,
      catalogModelCount: 46,
    }),
  ]),
  customProviders: Object.freeze([]),
});

const MULTI_PROVIDER_SNAPSHOT: PiModelConfigurationSnapshot = Object.freeze({
  ...SNAPSHOT,
  providers: Object.freeze([
    ...SNAPSHOT.providers,
    Object.freeze({
      id: "anthropic",
      name: "Anthropic",
      builtIn: true,
      hasCustomConfiguration: false,
      configured: true,
      authSource: "environment",
      authLabel: "ANTHROPIC_API_KEY",
      supportsApiKey: true,
      supportsOAuth: true,
      catalogModelCount: 12,
    }),
  ]),
});

function bootstrap(): RuntimeBootstrap {
  return {
    state: { model: MODELS[0] },
    models: MODELS,
  } as unknown as RuntimeBootstrap;
}

function renderWorkspace(apiOverrides: Partial<StellaDesktopApi> = {}) {
  const api = {
    modelConfigurationInitialize: vi.fn(async () => SNAPSHOT),
    modelConfigurationRevealApiKey: vi.fn(async () => ({ providerId: "openai", apiKey: "resolved-secret", source: "OPENAI_API_KEY" })),
    modelConfigurationTestConnection: vi.fn(async () => ({
      ok: true,
      code: "success",
      providerId: "openai",
      modelId: "gpt-5.6-sol",
      responseModel: "gpt-5.6-sol",
      latencyMs: 321,
      checkedAt: Date.now(),
      message: "最小模型请求已成功返回。",
    })),
    modelConfigurationSaveApiKey: vi.fn(async () => SNAPSHOT),
    modelConfigurationDeleteCredential: vi.fn(async () => SNAPSHOT),
    modelConfigurationUpsertProvider: vi.fn(async () => SNAPSHOT),
    modelConfigurationDeleteProvider: vi.fn(async () => SNAPSHOT),
    revealPath: vi.fn(async () => undefined),
    ...apiOverrides,
  } as unknown as StellaDesktopApi;
  const onModelChange = vi.fn(async () => undefined);
  const onRuntimeRefresh = vi.fn(async () => bootstrap());
  const onNotify = vi.fn();
  render(
    <ModelConfigurationWorkspace
      api={api}
      bootstrap={bootstrap()}
      online
      modelChanging={false}
      onOpenSidebar={vi.fn()}
      onModelChange={onModelChange}
      onRuntimeRefresh={onRuntimeRefresh}
      onNotify={onNotify}
    />,
  );
  return { api, onModelChange, onRuntimeRefresh, onNotify };
}

afterEach(() => cleanup());

describe("ModelConfigurationWorkspace", () => {
  it("shows the active route and switches only through Pi's available model catalog", async () => {
    const user = userEvent.setup();
    const { onModelChange } = renderWorkspace();
    await within(screen.getByLabelText("Provider 列表")).findByRole("button", { name: /OpenAI/ });

    expect(screen.getByLabelText("当前模型路由").textContent).toContain("GPT-5.6 Sol");
    const catalog = screen.getByLabelText("可用模型目录");
    expect(within(catalog).getByText("GPT-4.1")).toBeTruthy();
    await user.click(within(catalog).getAllByRole("button", { name: "设为全局" })[0]!);
    expect(onModelChange).toHaveBeenCalledWith(MODELS[1]);
  });

  it("sends a newly entered key one-way, reloads Pi, and clears the input", async () => {
    const user = userEvent.setup();
    const save = vi.fn(async () => SNAPSHOT);
    const { onRuntimeRefresh, onNotify } = renderWorkspace({ modelConfigurationSaveApiKey: save });
    await within(screen.getByLabelText("Provider 列表")).findByRole("button", { name: /OpenAI/ });
    const keyInput = screen.getByLabelText("OpenAI API key") as HTMLInputElement;

    await user.type(keyInput, "secret-input");
    await user.click(screen.getByRole("button", { name: "安全保存并应用" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ providerId: "openai", apiKey: "secret-input" }));
    expect(onRuntimeRefresh).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith(expect.stringContaining("凭据已保存"), "success");
    expect(keyInput.value).toBe("");
  });

  it("reveals the current API key only after an explicit click and clears it when hidden", async () => {
    const user = userEvent.setup();
    const reveal = vi.fn(async () => ({ providerId: "openai", apiKey: "on-demand-secret", source: "OPENAI_API_KEY" }));
    const { api } = renderWorkspace({ modelConfigurationRevealApiKey: reveal });
    await within(screen.getByLabelText("Provider 列表")).findByRole("button", { name: /OpenAI/ });
    const currentKey = screen.getByLabelText("OpenAI 当前 API key") as HTMLInputElement;

    expect(reveal).not.toHaveBeenCalled();
    expect(currentKey.type).toBe("password");
    expect(currentKey.value).toBe("");
    expect(currentKey.placeholder).toContain("点击查看");
    expect(document.body.textContent).not.toContain("on-demand-secret");

    await user.click(screen.getByRole("button", { name: "查看当前 API key" }));
    await waitFor(() => expect(reveal).toHaveBeenCalledWith("openai"));
    expect(currentKey.type).toBe("text");
    expect(currentKey.value).toBe("on-demand-secret");

    await user.click(screen.getByRole("button", { name: "隐藏当前 API key" }));
    expect(currentKey.type).toBe("password");
    expect(currentKey.value).toBe("");
    expect(api.modelConfigurationInitialize).toHaveBeenCalledTimes(1);
  });

  it("clears draft visibility and ignores a late key reveal after switching Provider", async () => {
    const user = userEvent.setup();
    let resolveReveal: ((result: PiApiKeyRevealResult) => void) | undefined;
    const reveal = vi.fn(() => new Promise<PiApiKeyRevealResult>((resolve) => { resolveReveal = resolve; }));
    renderWorkspace({
      modelConfigurationInitialize: vi.fn(async () => MULTI_PROVIDER_SNAPSHOT),
      modelConfigurationRevealApiKey: reveal,
    });
    const providers = screen.getByLabelText("Provider 列表");
    await within(providers).findByRole("button", { name: /OpenAI/ });

    const openAiDraft = screen.getByLabelText("OpenAI API key") as HTMLInputElement;
    await user.type(openAiDraft, "draft-visible");
    await user.click(screen.getByRole("button", { name: "显示新 API key" }));
    expect(openAiDraft.type).toBe("text");
    await user.click(screen.getByRole("button", { name: "查看当前 API key" }));

    await user.click(within(providers).getByRole("button", { name: /Anthropic/ }));
    const anthropicDraft = screen.getByLabelText("Anthropic API key") as HTMLInputElement;
    expect(anthropicDraft.type).toBe("password");
    expect(anthropicDraft.value).toBe("");

    resolveReveal?.({ providerId: "openai", apiKey: "late-openai-secret", source: "OPENAI_API_KEY" });
    await Promise.resolve();
    expect(screen.queryByDisplayValue("late-openai-secret")).toBeNull();
    expect((screen.getByLabelText("Anthropic 当前 API key") as HTMLInputElement).value).not.toBe("late-openai-secret");
  });

  it("tests the selected model with a draft key without saving or refreshing the Pi session", async () => {
    const user = userEvent.setup();
    const testConnection = vi.fn(async () => ({
      ok: true,
      code: "success" as const,
      providerId: "openai",
      modelId: "gpt-5.6-sol",
      latencyMs: 184,
      checkedAt: Date.now(),
      message: "最小模型请求已成功返回。",
    }));
    const { onRuntimeRefresh, onNotify } = renderWorkspace({ modelConfigurationTestConnection: testConnection });
    await within(screen.getByLabelText("Provider 列表")).findByRole("button", { name: /OpenAI/ });

    await user.type(screen.getByLabelText("OpenAI API key"), "draft-secret");
    await user.click(screen.getByRole("button", { name: "测试 OpenAI 连通性" }));

    await waitFor(() => expect(testConnection).toHaveBeenCalledWith({
      providerId: "openai",
      modelId: "gpt-5.6-sol",
      apiKey: "draft-secret",
    }));
    expect(await screen.findByText("连通已验证")).toBeTruthy();
    expect(screen.getAllByText(/184 ms/).length).toBeGreaterThan(0);
    expect(onRuntimeRefresh).not.toHaveBeenCalled();
    expect(onNotify).toHaveBeenCalledWith(expect.stringContaining("连通测试成功"), "success");
  });

  it("prevents Provider changes and credential mutations while a billable test request is running", async () => {
    const user = userEvent.setup();
    let finishTest: ((result: PiModelConnectionTestResult) => void) | undefined;
    const testConnection = vi.fn(() => new Promise<PiModelConnectionTestResult>((resolve) => { finishTest = resolve; }));
    renderWorkspace({
      modelConfigurationInitialize: vi.fn(async () => MULTI_PROVIDER_SNAPSHOT),
      modelConfigurationTestConnection: testConnection as unknown as StellaDesktopApi["modelConfigurationTestConnection"],
    });
    const providers = screen.getByLabelText("Provider 列表");
    await within(providers).findByRole("button", { name: /OpenAI/ });

    await user.click(screen.getByRole("button", { name: "测试 OpenAI 连通性" }));
    await waitFor(() => expect(testConnection).toHaveBeenCalledTimes(1));

    expect((within(providers).getByRole("button", { name: /Anthropic/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "刷新" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "自定义 Provider" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "创建覆盖" }) as HTMLButtonElement).disabled).toBe(true);
    finishTest?.({
      ok: true,
      code: "success",
      providerId: "openai",
      modelId: "gpt-5.6-sol",
      latencyMs: 1,
      checkedAt: Date.now(),
      message: "ok",
    });
    await screen.findByText("连通已验证");
  });

  it("shows a failed connection test inline without treating local configuration as verified", async () => {
    const user = userEvent.setup();
    const testConnection = vi.fn(async () => ({
      ok: false,
      code: "authentication" as const,
      providerId: "openai",
      modelId: "gpt-5.6-sol",
      latencyMs: 90,
      checkedAt: Date.now(),
      message: "鉴权失败：API Key 无效。",
    }));
    renderWorkspace({ modelConfigurationTestConnection: testConnection });
    await within(screen.getByLabelText("Provider 列表")).findByRole("button", { name: /OpenAI/ });

    await user.click(screen.getByRole("button", { name: "测试 OpenAI 连通性" }));

    expect((await screen.findByRole("alert")).textContent).toContain("鉴权失败：API Key 无效。");
    expect(screen.getByText("测试未通过")).toBeTruthy();
    expect(screen.getByText("CHECK FAILED")).toBeTruthy();
  });
});

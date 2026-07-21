import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelSummary, RuntimeBootstrap, StellaDesktopApi } from "../../src/shared/contracts";
import type { PiModelConfigurationSnapshot } from "../../src/shared/model-configuration";
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

function bootstrap(): RuntimeBootstrap {
  return {
    state: { model: MODELS[0] },
    models: MODELS,
  } as unknown as RuntimeBootstrap;
}

function renderWorkspace(apiOverrides: Partial<StellaDesktopApi> = {}) {
  const api = {
    modelConfigurationInitialize: vi.fn(async () => SNAPSHOT),
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
    await screen.findByRole("button", { name: /OpenAI/ });

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
    await screen.findByRole("button", { name: /OpenAI/ });
    const keyInput = screen.getByLabelText("OpenAI API key") as HTMLInputElement;

    await user.type(keyInput, "secret-input");
    await user.click(screen.getByRole("button", { name: "安全保存并应用" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith({ providerId: "openai", apiKey: "secret-input" }));
    expect(onRuntimeRefresh).toHaveBeenCalledTimes(1);
    expect(onNotify).toHaveBeenCalledWith(expect.stringContaining("已连接"), "success");
    expect(keyInput.value).toBe("");
  });
});

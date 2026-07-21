// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiModelConfigurationProviderInput } from "../../src/shared/model-configuration";
import {
  FileModelConfigurationStorage,
  ModelConfigurationService,
  type ModelCatalogInspection,
  type ModelConfigurationRuntime,
  type ModelConfigurationStorage,
} from "../../src/main/model-configuration-service";

class MemoryModelConfigurationStorage implements ModelConfigurationStorage {
  readonly values = new Map<string, string>();

  constructor(entries: Readonly<Record<string, string>> = {}) {
    for (const [path, value] of Object.entries(entries)) this.values.set(path.replace(/\\/g, "/"), value);
  }

  async read(path: string): Promise<string | undefined> {
    return this.values.get(path.replace(/\\/g, "/"));
  }

  async update(path: string, transform: (current: string) => string): Promise<void> {
    const key = path.replace(/\\/g, "/");
    this.values.set(key, transform(this.values.get(key) ?? ""));
  }
}

const INSPECTION: ModelCatalogInspection = Object.freeze({
  providers: Object.freeze([
    Object.freeze({
      id: "openai",
      name: "OpenAI",
      builtIn: true,
      configured: false,
      supportsApiKey: true,
      supportsOAuth: false,
      catalogModelCount: 46,
    }),
    Object.freeze({
      id: "ollama",
      name: "Ollama",
      builtIn: false,
      configured: true,
      authSource: "models_json_key",
      supportsApiKey: true,
      supportsOAuth: false,
      catalogModelCount: 1,
    }),
  ]),
});

function fakeRuntime(overrides: Partial<ModelConfigurationRuntime> = {}): ModelConfigurationRuntime {
  const model = {
    id: "gpt-test",
    name: "GPT Test",
    provider: "openai",
    api: "openai-responses",
    baseUrl: "https://api.openai.test/v1",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 16_384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  return {
    getProvider: vi.fn((providerId: string) => providerId === "openai" ? ({
      id: "openai",
      name: "OpenAI",
      auth: { apiKey: { name: "OpenAI API key" } },
    }) : undefined),
    getModels: vi.fn((providerId?: string) => !providerId || providerId === "openai" ? [model] : []),
    getModel: vi.fn((providerId: string, modelId: string) => providerId === "openai" && modelId === model.id ? model : undefined),
    checkAuth: vi.fn(async (providerId: string) => providerId === "openai" ? ({ type: "api_key", source: "OPENAI_API_KEY" }) : undefined),
    getAuth: vi.fn(async () => ({ auth: { apiKey: "resolved-secret" }, source: "OPENAI_API_KEY" })),
    listCredentials: vi.fn(async () => []),
    completeSimple: vi.fn(async () => ({
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "openai",
      model: model.id,
      responseModel: model.id,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    })),
    ...overrides,
  } as unknown as ModelConfigurationRuntime;
}

function service(
  storage: MemoryModelConfigurationStorage,
  inspection = INSPECTION,
  runtime: ModelConfigurationRuntime = fakeRuntime(),
) {
  return new ModelConfigurationService({
    agentDir: "C:/pi-agent",
    storage,
    inspect: vi.fn(async () => inspection),
    runtimeFactory: vi.fn(async () => runtime),
  });
}

function providerInput(overrides: Partial<PiModelConfigurationProviderInput> = {}): PiModelConfigurationProviderInput {
  return {
    id: "ollama",
    name: "Ollama Local",
    baseUrl: "http://localhost:11434/v1",
    api: "openai-completions",
    authHeader: false,
    models: [{
      id: "qwen2.5-coder:7b",
      name: "Qwen Coder",
      reasoning: false,
      imageInput: false,
      contextWindow: 128_000,
      maxTokens: 16_384,
    }],
    ...overrides,
  };
}

describe("ModelConfigurationService", () => {
  it("serializes concurrent cross-process-compatible file updates without leaving partial JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "stella-model-config-"));
    const path = join(directory, "auth.json");
    const storage = new FileModelConfigurationStorage();
    try {
      const increment = (contents: string) => JSON.stringify({ count: ((JSON.parse(contents || "{}") as { count?: number }).count ?? 0) + 1 });
      await Promise.all([storage.update(path, increment), storage.update(path, increment)]);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ count: 2 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs a real isolated Pi request against an OpenAI-compatible endpoint", async () => {
    let receivedAuthorization = "";
    let receivedBody = "";
    const server = createServer(async (request, response) => {
      receivedAuthorization = request.headers.authorization ?? "";
      for await (const chunk of request) receivedBody += chunk.toString();
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end([
        `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "stub-model", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}`,
        "",
        `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "stub-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n"));
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("无法创建本地模型测试端点");

    const directory = await mkdtemp(join(tmpdir(), "stella-model-probe-"));
    try {
      await writeFile(join(directory, "models.json"), JSON.stringify({
        providers: {
          "local-stub": {
            name: "Local Stub",
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            api: "openai-completions",
            models: [{
              id: "stub-model",
              name: "Stub Model",
              reasoning: false,
              input: ["text"],
              contextWindow: 8_192,
              maxTokens: 1_024,
            }],
          },
        },
      }), "utf8");
      await writeFile(join(directory, "auth.json"), JSON.stringify({
        "local-stub": { type: "api_key", key: "stub-secret" },
      }), "utf8");
      const target = new ModelConfigurationService({
        agentDir: directory,
        storage: new FileModelConfigurationStorage(),
        inspect: vi.fn(async () => ({ providers: [] })),
      });

      const result = await target.testConnection({ providerId: "local-stub", modelId: "stub-model" });

      expect(result).toMatchObject({ ok: true, code: "success", providerId: "local-stub", modelId: "stub-model" });
      expect(receivedAuthorization).toBe("Bearer stub-secret");
      expect(JSON.parse(receivedBody)).toMatchObject({ model: "stub-model", stream: true, max_completion_tokens: 8 });
      expect(JSON.stringify(result)).not.toContain("stub-secret");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns credential-blind provider metadata and never exposes inline keys", async () => {
    const storage = new MemoryModelConfigurationStorage({
      "C:/pi-agent/models.json": JSON.stringify({
        providers: {
          ollama: {
            name: "Ollama",
            baseUrl: "http://localhost:11434/v1",
            api: "openai-completions",
            apiKey: "super-secret-value",
            headers: { "x-secret": "also-secret" },
            models: [{ id: "qwen2.5-coder:7b" }],
          },
        },
      }),
    });

    const snapshot = await service(storage).snapshot();

    expect(snapshot.customProviders[0]).toMatchObject({
      id: "ollama",
      hasInlineApiKey: true,
      hasAdvancedConfiguration: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain("super-secret-value");
    expect(JSON.stringify(snapshot)).not.toContain("also-secret");
  });

  it("reveals an effective API key only through the explicit on-demand operation", async () => {
    const storage = new MemoryModelConfigurationStorage();
    const runtime = fakeRuntime();
    const target = service(storage, INSPECTION, runtime);

    const snapshot = await target.snapshot();
    expect(JSON.stringify(snapshot)).not.toContain("resolved-secret");

    await expect(target.revealApiKey("openai")).resolves.toEqual({
      providerId: "openai",
      apiKey: "resolved-secret",
      source: "OPENAI_API_KEY",
    });
    expect(runtime.getAuth).toHaveBeenCalledWith("openai");
  });

  it("never exposes an OAuth access token as an API key", async () => {
    const getAuth = vi.fn(async () => ({ auth: { apiKey: "oauth-access-token" }, source: "OAuth" }));
    const runtime = fakeRuntime({
      checkAuth: vi.fn(async () => ({ type: "oauth", source: "OAuth" })),
      listCredentials: vi.fn(async () => [{ providerId: "openai", type: "oauth" }]),
      getAuth: getAuth as unknown as ModelConfigurationRuntime["getAuth"],
    });

    await expect(service(new MemoryModelConfigurationStorage(), INSPECTION, runtime).revealApiKey("openai"))
      .rejects.toThrow("不显示访问令牌");
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("does not execute a configured credential command when revealing a key", async () => {
    const getAuth = vi.fn(async () => ({ auth: { apiKey: "command-output" }, source: "auth.json" }));
    const runtime = fakeRuntime({
      listCredentials: vi.fn(async () => [{ providerId: "openai", type: "api_key" }]),
      getAuth: getAuth as unknown as ModelConfigurationRuntime["getAuth"],
    });
    const storage = new MemoryModelConfigurationStorage({
      "C:/pi-agent/auth.json": JSON.stringify({ openai: { type: "api_key", key: "!password-manager read openai" } }),
    });

    await expect(service(storage, INSPECTION, runtime).revealApiKey("openai"))
      .rejects.toThrow("不会执行");
    expect(getAuth).not.toHaveBeenCalled();
  });

  it("tests a selected model with an unsaved key without persisting or returning the secret", async () => {
    const storage = new MemoryModelConfigurationStorage();
    const completeSimple = vi.fn(fakeRuntime().completeSimple);
    const runtime = fakeRuntime({ completeSimple: completeSimple as ModelConfigurationRuntime["completeSimple"] });

    const result = await service(storage, INSPECTION, runtime).testConnection({
      providerId: "openai",
      modelId: "gpt-test",
      apiKey: "temporary-secret",
    });

    expect(result).toMatchObject({ ok: true, code: "success", providerId: "openai", modelId: "gpt-test" });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(result)).not.toContain("temporary-secret");
    expect(storage.values.size).toBe(0);
    expect(completeSimple).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "openai", id: "gpt-test" }),
      expect.objectContaining({ messages: [expect.objectContaining({ content: "Reply only with OK." })] }),
      expect.objectContaining({ apiKey: "temporary-secret", maxTokens: 8, maxRetries: 0 }),
    );
  });

  it("treats a resolved stream error as failure and redacts credentials and authorization headers", async () => {
    const runtime = fakeRuntime({
      completeSimple: vi.fn(async () => ({
        stopReason: "error",
        errorMessage: "401 invalid API key temporary-secret; Authorization: Bearer server-token",
      })) as unknown as ModelConfigurationRuntime["completeSimple"],
    });

    const result = await service(new MemoryModelConfigurationStorage(), INSPECTION, runtime).testConnection({
      providerId: "openai",
      modelId: "gpt-test",
      apiKey: "temporary-secret",
    });

    expect(result).toMatchObject({ ok: false, code: "authentication", modelId: "gpt-test" });
    expect(JSON.stringify(result)).not.toContain("temporary-secret");
    expect(JSON.stringify(result)).not.toContain("server-token");
  });

  it("never returns untrusted Provider error text that echoes the current resolved credential", async () => {
    const resolvedCredential = "arbitrary-current-credential-without-known-prefix";
    const runtime = fakeRuntime({
      getAuth: vi.fn(async () => ({ auth: { apiKey: resolvedCredential }, source: "auth.json" })) as unknown as ModelConfigurationRuntime["getAuth"],
      completeSimple: vi.fn(async () => {
        throw Object.assign(
          new Error(`upstream rejected credential ${resolvedCredential}; internal gateway detail`),
          { code: resolvedCredential },
        );
      }) as unknown as ModelConfigurationRuntime["completeSimple"],
    });

    const result = await service(new MemoryModelConfigurationStorage(), INSPECTION, runtime).testConnection({
      providerId: "openai",
      modelId: "gpt-test",
    });

    expect(result).toMatchObject({ ok: false, code: "unknown", modelId: "gpt-test" });
    expect(JSON.stringify(result)).not.toContain(resolvedCredential);
    expect(JSON.stringify(result)).not.toContain("internal gateway detail");
    expect(result.message).toContain("未直接显示");
  });

  it("reports an unavailable test model without making a provider request", async () => {
    const completeSimple = vi.fn(fakeRuntime().completeSimple);
    const runtime = fakeRuntime({ completeSimple: completeSimple as ModelConfigurationRuntime["completeSimple"] });

    const result = await service(new MemoryModelConfigurationStorage(), INSPECTION, runtime).testConnection({
      providerId: "openai",
      modelId: "missing-model",
    });

    expect(result).toMatchObject({ ok: false, code: "model", modelId: "missing-model" });
    expect(completeSimple).not.toHaveBeenCalled();
  });

  it("stores an API key in auth.json while preserving provider-scoped environment values", async () => {
    const storage = new MemoryModelConfigurationStorage({
      "C:/pi-agent/auth.json": JSON.stringify({
        openai: { type: "api_key", key: "old", env: { HTTPS_PROXY: "http://proxy.local" } },
      }),
    });

    await service(storage).saveApiKey({ providerId: "openai", apiKey: "new-key" });

    expect(JSON.parse(storage.values.get("C:/pi-agent/auth.json") ?? "{}")).toEqual({
      openai: { type: "api_key", key: "new-key", env: { HTTPS_PROXY: "http://proxy.local" } },
    });
  });

  it("rejects keys for unknown providers instead of creating unaudited auth entries", async () => {
    const storage = new MemoryModelConfigurationStorage();

    await expect(service(storage).saveApiKey({ providerId: "unknown", apiKey: "key" })).rejects.toThrow("Provider 不存在");
    expect(storage.values.size).toBe(0);
  });

  it("updates form-owned provider fields but preserves inline auth and advanced compatibility", async () => {
    const storage = new MemoryModelConfigurationStorage({
      "C:/pi-agent/models.json": JSON.stringify({
        providers: {
          ollama: {
            baseUrl: "http://old.local/v1",
            api: "openai-completions",
            apiKey: "$OLLAMA_KEY",
            compat: { supportsDeveloperRole: false },
            models: [{ id: "qwen2.5-coder:7b", headers: { "x-route": "local" }, contextWindow: 64_000 }],
          },
        },
      }),
    });

    await service(storage).upsertProvider(providerInput());

    const stored = JSON.parse(storage.values.get("C:/pi-agent/models.json") ?? "{}") as Record<string, any>;
    expect(stored.providers.ollama.apiKey).toBe("$OLLAMA_KEY");
    expect(stored.providers.ollama.compat).toEqual({ supportsDeveloperRole: false });
    expect(stored.providers.ollama.models[0].headers).toEqual({ "x-route": "local" });
    expect(stored.providers.ollama.models[0]).toMatchObject({ contextWindow: 128_000, maxTokens: 16_384 });
  });

  it("rejects incomplete custom providers before touching models.json", async () => {
    const storage = new MemoryModelConfigurationStorage();

    await expect(service(storage).upsertProvider(providerInput({ baseUrl: undefined }))).rejects.toThrow("Base URL");
    expect(storage.values.size).toBe(0);
  });

  it("preserves a valid but form-unmanaged Pi API value when editing other fields", async () => {
    const storage = new MemoryModelConfigurationStorage({
      "C:/pi-agent/models.json": JSON.stringify({ providers: { openai: { api: "openai-codex-responses", baseUrl: "https://proxy.example/v1" } } }),
    });

    await service(storage).upsertProvider({
      id: "openai",
      name: "Proxy OpenAI",
      baseUrl: "https://new-proxy.example/v1",
      authHeader: false,
      models: [],
    });

    const stored = JSON.parse(storage.values.get("C:/pi-agent/models.json") ?? "{}") as Record<string, any>;
    expect(stored.providers.openai.api).toBe("openai-codex-responses");
    expect(stored.providers.openai.baseUrl).toBe("https://new-proxy.example/v1");
  });

  it("does not expose credentials embedded in a legacy Base URL and preserves them unless explicitly replaced", async () => {
    const storage = new MemoryModelConfigurationStorage({
      "C:/pi-agent/models.json": JSON.stringify({ providers: { openai: { baseUrl: "https://user:pass@proxy.example/v1" } } }),
    });
    const target = service(storage);

    const snapshot = await target.snapshot();
    expect(snapshot.customProviders[0]).toMatchObject({ baseUrl: undefined, hasAdvancedConfiguration: true });
    expect(JSON.stringify(snapshot)).not.toContain("pass");

    await target.upsertProvider({ id: "openai", name: "Proxy", authHeader: false, models: [] });
    const stored = JSON.parse(storage.values.get("C:/pi-agent/models.json") ?? "{}") as Record<string, any>;
    expect(stored.providers.openai.baseUrl).toBe("https://user:pass@proxy.example/v1");
  });
});

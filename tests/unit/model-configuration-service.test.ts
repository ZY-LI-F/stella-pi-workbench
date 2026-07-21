// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PiModelConfigurationProviderInput } from "../../src/shared/model-configuration";
import {
  FileModelConfigurationStorage,
  ModelConfigurationService,
  type ModelCatalogInspection,
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

function service(storage: MemoryModelConfigurationStorage, inspection = INSPECTION) {
  return new ModelConfigurationService({
    agentDir: "C:/pi-agent",
    storage,
    inspect: vi.fn(async () => inspection),
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

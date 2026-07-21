import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import {
  isCustomModelApi,
  type PiCustomProviderConfiguration,
  type PiModelConfigurationModel,
  type PiModelConfigurationProviderInput,
  type PiModelConfigurationSnapshot,
  type PiModelProviderSummary,
  type SavePiApiKeyInput,
} from "../shared/model-configuration";

interface ProperLockfile {
  lock(
    path: string,
    options: Readonly<Record<string, unknown>>,
  ): Promise<() => Promise<void>>;
}

const require = createRequire(import.meta.url);
const lockfile = require("proper-lockfile") as ProperLockfile;

const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u;
const RESERVED_PROVIDER_IDS = new Set(["constructor", "prototype", "__proto__"]);
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;

type JsonObject = Record<string, unknown>;

export interface ModelProviderInspection {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly configured: boolean;
  readonly authSource?: string;
  readonly authLabel?: string;
  readonly credentialType?: "api_key" | "oauth";
  readonly supportsApiKey: boolean;
  readonly supportsOAuth: boolean;
  readonly catalogModelCount: number;
}

export interface ModelCatalogInspection {
  readonly providers: readonly ModelProviderInspection[];
  readonly error?: string;
}

export interface ModelConfigurationStorage {
  read(path: string): Promise<string | undefined>;
  update(path: string, transform: (current: string) => string): Promise<void>;
}

interface ModelConfigurationServiceDependencies {
  readonly agentDir: string;
  readonly storage: ModelConfigurationStorage;
  readonly inspect: () => Promise<ModelCatalogInspection>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/gu, (match) => (match[0] === '"' ? match : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/gu, (match, tail: string | undefined) => tail ?? (match[0] === '"' ? match : ""));
}

function plainObject(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return value as JsonObject;
}

function parseJsonObject(contents: string | undefined, path: string, empty: JsonObject): JsonObject {
  if (contents === undefined || contents.trim() === "") return structuredClone(empty);
  try {
    return plainObject(JSON.parse(stripJsonComments(contents)), path);
  } catch (cause) {
    throw new Error(`无法解析 ${path}: ${errorMessage(cause)}`);
  }
}

function optionalTrimmed(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${label} 必须是字符串`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiredIdentifier(value: unknown, label: string): string {
  const identifier = optionalTrimmed(value, label);
  if (!identifier) throw new Error(`${label} 不能为空`);
  if (!PROVIDER_ID_PATTERN.test(identifier)) {
    throw new Error(`${label} 只能包含字母、数字、点、下划线和连字符，且必须以字母或数字开头`);
  }
  if (RESERVED_PROVIDER_IDS.has(identifier)) throw new Error(`${label} 不能使用保留名称 ${identifier}`);
  return identifier;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return value;
}

function optionalUrl(value: unknown, label: string): string | undefined {
  const url = optionalTrimmed(value, label);
  if (!url) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new Error(`${label} 不是有效 URL: ${errorMessage(cause)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} 只支持 http 或 https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} 不能包含用户名或密码；请把凭据保存到 auth.json`);
  }
  return parsed.toString().replace(/\/$/u, "");
}

function urlContainsCredentials(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const parsed = new URL(value);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return false;
  }
}

function normalizedModel(value: PiModelConfigurationModel, index: number): PiModelConfigurationModel {
  const label = `模型 ${index + 1}`;
  const id = optionalTrimmed(value?.id, `${label} ID`);
  if (!id) throw new Error(`${label} ID 不能为空`);
  return Object.freeze({
    id,
    name: optionalTrimmed(value.name, `${label}名称`),
    reasoning: Boolean(value.reasoning),
    imageInput: Boolean(value.imageInput),
    contextWindow: positiveInteger(value.contextWindow, `${label}上下文窗口`),
    maxTokens: positiveInteger(value.maxTokens, `${label}最大输出`),
  });
}

function normalizedProviderInput(value: PiModelConfigurationProviderInput): PiModelConfigurationProviderInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Provider 配置必须是对象");
  }
  if (!Array.isArray(value.models)) throw new Error("Provider models 必须是数组");
  const models = value.models.map(normalizedModel);
  const duplicate = models.find((model, index) => models.findIndex((candidate) => candidate.id === model.id) !== index);
  if (duplicate) throw new Error(`Provider 中存在重复模型 ID: ${duplicate.id}`);
  if (value.api !== undefined && !isCustomModelApi(value.api)) {
    throw new Error(`不支持的模型 API: ${String(value.api)}`);
  }
  return Object.freeze({
    id: requiredIdentifier(value.id, "Provider ID"),
    name: optionalTrimmed(value.name, "Provider 名称"),
    baseUrl: optionalUrl(value.baseUrl, "Base URL"),
    api: value.api,
    authHeader: Boolean(value.authHeader),
    models: Object.freeze(models),
  });
}

function setOptional(record: JsonObject, key: string, value: unknown): void {
  if (value === undefined) delete record[key];
  else record[key] = value;
}

function modelsFromProvider(provider: JsonObject): readonly PiModelConfigurationModel[] {
  if (provider.models === undefined) return Object.freeze([]);
  if (!Array.isArray(provider.models)) throw new Error("models.json 中的 Provider models 必须是数组");
  return Object.freeze(provider.models.map((rawModel, index) => {
    const model = plainObject(rawModel, `models.json 模型 ${index + 1}`);
    const id = optionalTrimmed(model.id, `models.json 模型 ${index + 1} ID`);
    if (!id) throw new Error(`models.json 模型 ${index + 1} ID 不能为空`);
    return Object.freeze({
      id,
      name: optionalTrimmed(model.name, `models.json 模型 ${id} 名称`),
      reasoning: Boolean(model.reasoning),
      imageInput: Array.isArray(model.input) && model.input.includes("image"),
      contextWindow: typeof model.contextWindow === "number" ? positiveInteger(model.contextWindow, `模型 ${id} 上下文窗口`) : 128_000,
      maxTokens: typeof model.maxTokens === "number" ? positiveInteger(model.maxTokens, `模型 ${id} 最大输出`) : 16_384,
    });
  }));
}

function configuredProvidersFromJson(root: JsonObject, path: string): ReadonlyMap<string, PiCustomProviderConfiguration> {
  const providers = root.providers === undefined ? {} : plainObject(root.providers, `${path}.providers`);
  const result = new Map<string, PiCustomProviderConfiguration>();
  for (const [id, rawProvider] of Object.entries(providers)) {
    const provider = plainObject(rawProvider, `${path}.providers.${id}`);
    const configuredApi = provider.api === undefined ? undefined : optionalTrimmed(provider.api, `${id}.api`);
    const api = isCustomModelApi(configuredApi) ? configuredApi : undefined;
    const sensitiveBaseUrl = urlContainsCredentials(provider.baseUrl);
    const knownKeys = new Set(["name", "baseUrl", "apiKey", "api", "authHeader", "models"]);
    result.set(id, Object.freeze({
      id,
      name: optionalTrimmed(provider.name, `${id}.name`),
      baseUrl: sensitiveBaseUrl ? undefined : optionalTrimmed(provider.baseUrl, `${id}.baseUrl`),
      api,
      authHeader: Boolean(provider.authHeader),
      models: modelsFromProvider(provider),
      hasInlineApiKey: typeof provider.apiKey === "string" && provider.apiKey.length > 0,
      hasAdvancedConfiguration: sensitiveBaseUrl || Boolean(configuredApi && !api) || Object.keys(provider).some((key) => !knownKeys.has(key)),
    }));
  }
  return result;
}

function mergedModel(existing: unknown, input: PiModelConfigurationModel): JsonObject {
  const next = typeof existing === "object" && existing !== null && !Array.isArray(existing)
    ? { ...(existing as JsonObject) }
    : {};
  next.id = input.id;
  setOptional(next, "name", input.name);
  next.reasoning = input.reasoning;
  next.input = input.imageInput ? ["text", "image"] : ["text"];
  next.contextWindow = input.contextWindow;
  next.maxTokens = input.maxTokens;
  return next;
}

function serialized(value: JsonObject): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class FileModelConfigurationStorage implements ModelConfigurationStorage {
  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(path, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw cause;
    }
  }

  async update(path: string, transform: (current: string) => string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: DIRECTORY_MODE });
    try {
      await writeFile(path, "", { encoding: "utf8", flag: "wx", mode: FILE_MODE });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause;
    }
    const release = await lockfile.lock(path, {
      realpath: false,
      retries: Object.freeze({ retries: 10, factor: 2, minTimeout: 100, maxTimeout: 10_000, randomize: true }),
      stale: 30_000,
    });
    try {
      const current = await readFile(path, "utf8");
      const next = transform(current);
      const temporaryPath = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, next, { encoding: "utf8", mode: FILE_MODE });
      await chmod(temporaryPath, FILE_MODE);
      await rename(temporaryPath, path);
      await chmod(path, FILE_MODE);
    } finally {
      await release();
    }
  }
}

export class ModelConfigurationService {
  readonly #agentDir: string;
  readonly #modelsPath: string;
  readonly #authPath: string;
  readonly #storage: ModelConfigurationStorage;
  readonly #inspect: () => Promise<ModelCatalogInspection>;

  constructor(dependencies: ModelConfigurationServiceDependencies) {
    this.#agentDir = resolve(dependencies.agentDir);
    this.#modelsPath = join(this.#agentDir, "models.json");
    this.#authPath = join(this.#agentDir, "auth.json");
    this.#storage = dependencies.storage;
    this.#inspect = dependencies.inspect;
  }

  async snapshot(): Promise<PiModelConfigurationSnapshot> {
    const rawModels = parseJsonObject(await this.#storage.read(this.#modelsPath), this.#modelsPath, { providers: {} });
    const customProviders = configuredProvidersFromJson(rawModels, this.#modelsPath);
    const inspection = await this.#inspect();
    const providers: PiModelProviderSummary[] = inspection.providers.map((provider) => Object.freeze({
      ...provider,
      hasCustomConfiguration: customProviders.has(provider.id),
    }));
    for (const provider of customProviders.values()) {
      if (providers.some((candidate) => candidate.id === provider.id)) continue;
      providers.push(Object.freeze({
        id: provider.id,
        name: provider.name ?? provider.id,
        builtIn: false,
        hasCustomConfiguration: true,
        configured: provider.hasInlineApiKey,
        authSource: provider.hasInlineApiKey ? "models_json_key" : undefined,
        supportsApiKey: true,
        supportsOAuth: false,
        catalogModelCount: provider.models.length,
      }));
    }
    providers.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    return Object.freeze({
      agentDir: this.#agentDir,
      modelsPath: this.#modelsPath,
      authPath: this.#authPath,
      providers: Object.freeze(providers),
      customProviders: Object.freeze([...customProviders.values()].sort((left, right) => left.id.localeCompare(right.id))),
      configurationError: inspection.error,
    });
  }

  async saveApiKey(value: SavePiApiKeyInput): Promise<void> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("API key 配置必须是对象");
    const providerId = requiredIdentifier(value.providerId, "Provider ID");
    if (typeof value.apiKey !== "string" || value.apiKey.trim().length === 0) throw new Error("API key 不能为空");
    const inspection = await this.#inspect();
    if (!inspection.providers.some((provider) => provider.id === providerId && provider.supportsApiKey)) {
      throw new Error(`Provider 不存在或不支持 API key: ${providerId}`);
    }
    await this.#storage.update(this.#authPath, (contents) => {
      const root = parseJsonObject(contents, this.#authPath, {});
      const current = root[providerId];
      const currentEnv = typeof current === "object" && current !== null && !Array.isArray(current)
        ? (current as JsonObject).env
        : undefined;
      root[providerId] = currentEnv === undefined
        ? { type: "api_key", key: value.apiKey }
        : { type: "api_key", key: value.apiKey, env: currentEnv };
      return serialized(root);
    });
  }

  async deleteCredential(providerIdValue: unknown): Promise<void> {
    const providerId = requiredIdentifier(providerIdValue, "Provider ID");
    await this.#storage.update(this.#authPath, (contents) => {
      const root = parseJsonObject(contents, this.#authPath, {});
      if (!Object.hasOwn(root, providerId)) throw new Error(`auth.json 中没有 ${providerId} 的已保存凭据`);
      delete root[providerId];
      return serialized(root);
    });
  }

  async upsertProvider(value: PiModelConfigurationProviderInput): Promise<void> {
    const input = normalizedProviderInput(value);
    const inspection = await this.#inspect();
    const builtIn = inspection.providers.some((provider) => provider.id === input.id && provider.builtIn);
    if (!builtIn) {
      if (!input.baseUrl) throw new Error("自定义 Provider 必须填写 Base URL");
      if (!input.api) throw new Error("自定义 Provider 必须选择 API 协议");
      if (input.models.length === 0) throw new Error("自定义 Provider 至少需要一个模型");
    }
    await this.#storage.update(this.#modelsPath, (contents) => {
      const root = parseJsonObject(contents, this.#modelsPath, { providers: {} });
      const providers = root.providers === undefined ? {} : plainObject(root.providers, `${this.#modelsPath}.providers`);
      const current = providers[input.id];
      const next = typeof current === "object" && current !== null && !Array.isArray(current)
        ? { ...(current as JsonObject) }
        : {};
      const currentModels = Array.isArray(next.models) ? next.models : [];
      const currentModelsById = new Map(currentModels.flatMap((candidate) => {
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return [];
        const id = (candidate as JsonObject).id;
        return typeof id === "string" ? [[id, candidate] as const] : [];
      }));
      setOptional(next, "name", input.name);
      if (input.baseUrl !== undefined || !urlContainsCredentials(next.baseUrl)) {
        setOptional(next, "baseUrl", input.baseUrl);
      }
      if (input.api !== undefined || typeof next.api !== "string" || isCustomModelApi(next.api)) {
        setOptional(next, "api", input.api);
      }
      if (input.authHeader) next.authHeader = true;
      else delete next.authHeader;
      if (input.models.length > 0) {
        next.models = input.models.map((model) => mergedModel(currentModelsById.get(model.id), model));
      } else {
        delete next.models;
      }
      providers[input.id] = next;
      root.providers = providers;
      return serialized(root);
    });
  }

  async deleteProvider(providerIdValue: unknown): Promise<void> {
    const providerId = requiredIdentifier(providerIdValue, "Provider ID");
    await this.#storage.update(this.#modelsPath, (contents) => {
      const root = parseJsonObject(contents, this.#modelsPath, { providers: {} });
      const providers = root.providers === undefined ? {} : plainObject(root.providers, `${this.#modelsPath}.providers`);
      if (!Object.hasOwn(providers, providerId)) throw new Error(`models.json 中不存在 Provider 配置: ${providerId}`);
      delete providers[providerId];
      root.providers = providers;
      return serialized(root);
    });
  }
}

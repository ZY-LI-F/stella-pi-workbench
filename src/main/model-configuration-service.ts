import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  isCustomModelApi,
  type PiApiKeyRevealResult,
  type PiCustomProviderConfiguration,
  type PiModelConfigurationModel,
  type PiModelConfigurationProviderInput,
  type PiModelConfigurationSnapshot,
  type PiModelConnectionTestCode,
  type PiModelConnectionTestResult,
  type PiModelProviderSummary,
  type SavePiApiKeyInput,
  type TestPiModelConnectionInput,
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
const CONNECTION_TEST_TIMEOUT_MS = 15_000;
const CONNECTION_TEST_MAX_TOKENS = 8;
const CONNECTION_ERROR_MAX_LENGTH = 360;

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

export type ModelConfigurationRuntime = Pick<
  ModelRuntime,
  "getProvider" | "getModels" | "getModel" | "checkAuth" | "getAuth" | "listCredentials" | "completeSimple"
>;

interface ModelConfigurationServiceDependencies {
  readonly agentDir: string;
  readonly storage: ModelConfigurationStorage;
  readonly inspect: () => Promise<ModelCatalogInspection>;
  readonly runtimeFactory?: () => Promise<ModelConfigurationRuntime>;
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

function normalizedConnectionTestInput(value: TestPiModelConnectionInput): TestPiModelConnectionInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("连接测试配置必须是对象");
  }
  if (value.apiKey !== undefined && typeof value.apiKey !== "string") {
    throw new Error("API key 必须是字符串");
  }
  const apiKey = typeof value.apiKey === "string" && value.apiKey.trim() ? value.apiKey : undefined;
  return Object.freeze({
    providerId: requiredIdentifier(value.providerId, "Provider ID"),
    modelId: optionalTrimmed(value.modelId, "模型 ID"),
    apiKey,
  });
}

function redactedConnectionError(cause: unknown, secrets: readonly string[] = []): string {
  let message = errorMessage(cause).replace(/[\r\n]+/gu, " ").trim();
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  message = message
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/giu, "$1[REDACTED]")
    .replace(/((?:api[-_ ]?key|x-api-key)(?:\s+(?:provided|value))?\s*[:=]\s*)[^\s,;]+/giu, "$1[REDACTED]")
    .replace(/([?&](?:key|api_key)=)[^&\s]+/giu, "$1[REDACTED]")
    .replace(/\b(?:sk-(?:ant-)?|xai-|AIza)[a-zA-Z0-9._-]{6,}\b/gu, "[REDACTED]");
  return (message || "未知错误").slice(0, CONNECTION_ERROR_MAX_LENGTH);
}

function errorDiagnostic(cause: unknown, depth = 0): string {
  if (depth > 3) return "";
  const parts = [errorMessage(cause)];
  if (typeof cause !== "object" || cause === null) return parts.join(" ");
  const record = cause as Readonly<Record<string, unknown>>;
  for (const key of ["name", "code", "status", "statusCode", "type"] as const) {
    const value = record[key];
    if (typeof value === "string" || typeof value === "number") parts.push(`${key}:${String(value)}`);
  }
  if (record.cause !== undefined && record.cause !== cause) parts.push(errorDiagnostic(record.cause, depth + 1));
  return parts.join(" ");
}

function connectionFailure(
  cause: unknown,
  secrets: readonly string[],
  timedOut: boolean,
): Readonly<{ code: PiModelConnectionTestCode; message: string }> {
  // The detailed Provider response is deliberately used only for classification.
  // Compatible endpoints are untrusted and may echo credentials in arbitrary formats.
  const detail = redactedConnectionError(errorDiagnostic(cause), secrets).toLocaleLowerCase();
  if (timedOut || /\babort(?:ed)?\b|timeout|timed out/u.test(detail)) {
    return Object.freeze({ code: "timeout", message: `连接测试超过 ${CONNECTION_TEST_TIMEOUT_MS / 1000} 秒，请检查网络、代理或端点响应速度。` });
  }
  if (/\b(?:auth|oauth)\b|\b401\b|unauthori[sz]ed|invalid (?:api )?key|api key auth failed|authentication failed|not configured/u.test(detail)) {
    return Object.freeze({ code: "authentication", message: "鉴权失败：API Key、OAuth 登录或凭据来源无效。" });
  }
  if (/\b403\b|forbidden|permission denied|access denied/u.test(detail)) {
    return Object.freeze({ code: "permission", message: "服务已响应，但当前凭据没有访问该模型的权限（403）。" });
  }
  if (/\b404\b|model[^.]{0,40}not found|unknown model|does not exist/u.test(detail)) {
    return Object.freeze({ code: "model", message: "服务已响应，但端点路径或所选模型不存在（404）。" });
  }
  if (/\b429\b|rate.?limit|quota|insufficient_quota|billing/u.test(detail)) {
    return Object.freeze({ code: "quota", message: "服务已响应，但账户额度不足、计费未启用或当前正在限流（429）。" });
  }
  if (/enotfound|eai_again|getaddrinfo|econnrefused|econnreset|network|fetch failed|socket|tls|certificate/u.test(detail)) {
    return Object.freeze({ code: "network", message: "无法到达 Provider，请检查 Base URL、网络、代理、DNS 与 TLS 配置。" });
  }
  if (/\bprovider\b|unknown provider/u.test(detail)) {
    return Object.freeze({ code: "provider", message: "Provider 配置无效或当前运行时无法加载该 Provider。" });
  }
  return Object.freeze({
    code: "unknown",
    message: "模型请求失败；Provider 错误正文因可能包含凭据而未直接显示。",
  });
}

function isCredentialCommand(value: unknown): boolean {
  return typeof value === "string" && value.trimStart().startsWith("!");
}

function containsCredentialCommand(value: unknown): boolean {
  if (isCredentialCommand(value)) return true;
  if (Array.isArray(value)) return value.some(containsCredentialCommand);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some(containsCredentialCommand);
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
  readonly #runtimeFactory: () => Promise<ModelConfigurationRuntime>;

  constructor(dependencies: ModelConfigurationServiceDependencies) {
    this.#agentDir = resolve(dependencies.agentDir);
    this.#modelsPath = join(this.#agentDir, "models.json");
    this.#authPath = join(this.#agentDir, "auth.json");
    this.#storage = dependencies.storage;
    this.#inspect = dependencies.inspect;
    this.#runtimeFactory = dependencies.runtimeFactory ?? (() => ModelRuntime.create({
      authPath: this.#authPath,
      modelsPath: this.#modelsPath,
      allowModelNetwork: false,
    }));
  }

  async #hasCredentialCommand(providerId: string): Promise<boolean> {
    const [authContents, modelsContents] = await Promise.all([
      this.#storage.read(this.#authPath),
      this.#storage.read(this.#modelsPath),
    ]);
    const auth = parseJsonObject(authContents, this.#authPath, {});
    const stored = auth[providerId];
    if (typeof stored === "object" && stored !== null && !Array.isArray(stored)) {
      const credential = stored as JsonObject;
      if (credential.type === "api_key" && isCredentialCommand(credential.key)) return true;
    }

    const models = parseJsonObject(modelsContents, this.#modelsPath, { providers: {} });
    const providers = models.providers === undefined ? {} : plainObject(models.providers, `${this.#modelsPath}.providers`);
    const configured = providers[providerId];
    if (typeof configured !== "object" || configured === null || Array.isArray(configured)) return false;
    const provider = configured as JsonObject;
    if (containsCredentialCommand(provider.apiKey) || containsCredentialCommand(provider.headers)) return true;
    if (!Array.isArray(provider.models)) return false;
    return provider.models.some((model) => {
      if (typeof model !== "object" || model === null || Array.isArray(model)) return false;
      return containsCredentialCommand((model as JsonObject).headers);
    });
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

  async revealApiKey(providerIdValue: unknown): Promise<PiApiKeyRevealResult> {
    const providerId = requiredIdentifier(providerIdValue, "Provider ID");
    let runtime: ModelConfigurationRuntime;
    try {
      runtime = await this.#runtimeFactory();
    } catch {
      throw new Error("无法加载 Pi 凭据配置；请修复 models.json 或 auth.json 后重试");
    }
    const provider = runtime.getProvider(providerId);
    if (!provider) throw new Error(`Provider 不存在: ${providerId}`);
    if (!provider.auth.apiKey) throw new Error(`${provider.name} 不使用 API Key 凭据`);

    let authCheck: Awaited<ReturnType<ModelConfigurationRuntime["checkAuth"]>>;
    let credentials: Awaited<ReturnType<ModelConfigurationRuntime["listCredentials"]>>;
    try {
      [authCheck, credentials] = await Promise.all([
        runtime.checkAuth(providerId),
        runtime.listCredentials(),
      ]);
    } catch {
      throw new Error(`无法读取 ${provider.name} 的凭据状态；请检查 Pi 凭据配置`);
    }
    const storedCredential = credentials.find((credential) => credential.providerId === providerId);
    if (storedCredential?.type === "oauth" || (!storedCredential && authCheck?.type === "oauth")) {
      throw new Error(`${provider.name} 当前使用 OAuth；为保护账户安全，不显示访问令牌`);
    }
    let hasCredentialCommand: boolean;
    try {
      hasCredentialCommand = await this.#hasCredentialCommand(providerId);
    } catch {
      throw new Error(`无法检查 ${provider.name} 的动态凭据配置；请检查 models.json 或 auth.json`);
    }
    if (hasCredentialCommand) {
      throw new Error(`动态命令凭据不能在本页显示；“查看”不会执行 ${provider.name} 配置中的 !command，可使用连接测试验证该凭据`);
    }

    let resolution: Awaited<ReturnType<ModelConfigurationRuntime["getAuth"]>>;
    try {
      resolution = await runtime.getAuth(providerId);
    } catch {
      throw new Error(`无法解析 ${provider.name} 的 API Key；请检查凭据来源是否可读`);
    }
    const apiKey = resolution?.auth.apiKey;
    if (typeof apiKey !== "string" || apiKey.length === 0) {
      throw new Error(`${provider.name} 当前没有可显示的单一 API Key；它可能使用组合凭据或无密钥认证`);
    }
    return Object.freeze({
      providerId,
      apiKey,
      source: resolution?.source,
    });
  }

  async testConnection(value: TestPiModelConnectionInput): Promise<PiModelConnectionTestResult> {
    const input = normalizedConnectionTestInput(value);
    const startedAt = Date.now();
    let modelId = input.modelId;
    const failure = (
      code: PiModelConnectionTestCode,
      message: string,
    ): PiModelConnectionTestResult => Object.freeze({
      ok: false,
      code,
      providerId: input.providerId,
      modelId,
      latencyMs: Math.max(0, Date.now() - startedAt),
      checkedAt: Date.now(),
      message,
    });

    let runtime: ModelConfigurationRuntime;
    try {
      runtime = await this.#runtimeFactory();
    } catch (cause) {
      const result = connectionFailure(cause, input.apiKey ? [input.apiKey] : [], false);
      return failure(result.code, result.message);
    }

    const provider = runtime.getProvider(input.providerId);
    if (!provider) return failure("provider", `Provider 不存在: ${input.providerId}`);
    const model = input.modelId
      ? runtime.getModel(input.providerId, input.modelId)
      : runtime.getModels(input.providerId)[0];
    if (!model) {
      return failure(
        "model",
        input.modelId
          ? `Provider ${provider.name} 中不存在模型 ${input.modelId}`
          : `Provider ${provider.name} 没有可用于测试的模型`,
      );
    }
    modelId = model.id;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONNECTION_TEST_TIMEOUT_MS);
    timeout.unref();
    try {
      const response = await runtime.completeSimple(
        model,
        {
          messages: [{ role: "user", content: "Reply only with OK.", timestamp: Date.now() }],
        },
        {
          apiKey: input.apiKey,
          maxTokens: CONNECTION_TEST_MAX_TOKENS,
          maxRetries: 0,
          timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
          signal: controller.signal,
        },
      );
      if (response.stopReason === "error" || response.stopReason === "aborted") {
        const result = connectionFailure(
          new Error(response.errorMessage || `模型请求以 ${response.stopReason} 结束`),
          input.apiKey ? [input.apiKey] : [],
          controller.signal.aborted,
        );
        return failure(result.code, result.message);
      }
      return Object.freeze({
        ok: true,
        code: "success",
        providerId: input.providerId,
        modelId: model.id,
        responseModel: response.responseModel,
        latencyMs: Math.max(0, Date.now() - startedAt),
        checkedAt: Date.now(),
        message: "最小模型请求已成功返回。",
      });
    } catch (cause) {
      const result = connectionFailure(cause, input.apiKey ? [input.apiKey] : [], controller.signal.aborted);
      return failure(result.code, result.message);
    } finally {
      clearTimeout(timeout);
    }
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

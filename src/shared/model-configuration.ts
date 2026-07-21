export const CUSTOM_MODEL_APIS = Object.freeze([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const);

export type CustomModelApi = (typeof CUSTOM_MODEL_APIS)[number];

export interface PiModelConfigurationModel {
  readonly id: string;
  readonly name?: string;
  readonly reasoning: boolean;
  readonly imageInput: boolean;
  readonly contextWindow: number;
  readonly maxTokens: number;
}

export interface PiCustomProviderConfiguration {
  readonly id: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly api?: CustomModelApi;
  readonly authHeader: boolean;
  readonly models: readonly PiModelConfigurationModel[];
  readonly hasInlineApiKey: boolean;
  readonly hasAdvancedConfiguration: boolean;
}

export interface PiModelProviderSummary {
  readonly id: string;
  readonly name: string;
  readonly builtIn: boolean;
  readonly hasCustomConfiguration: boolean;
  readonly configured: boolean;
  readonly authSource?: string;
  readonly authLabel?: string;
  readonly credentialType?: "api_key" | "oauth";
  readonly supportsApiKey: boolean;
  readonly supportsOAuth: boolean;
  readonly catalogModelCount: number;
}

export interface PiModelConfigurationSnapshot {
  readonly agentDir: string;
  readonly modelsPath: string;
  readonly authPath: string;
  readonly providers: readonly PiModelProviderSummary[];
  readonly customProviders: readonly PiCustomProviderConfiguration[];
  readonly configurationError?: string;
}

export interface SavePiApiKeyInput {
  readonly providerId: string;
  readonly apiKey: string;
}

export interface PiModelConfigurationProviderInput {
  readonly id: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly api?: CustomModelApi;
  readonly authHeader: boolean;
  readonly models: readonly PiModelConfigurationModel[];
}

export function isCustomModelApi(value: unknown): value is CustomModelApi {
  return typeof value === "string" && CUSTOM_MODEL_APIS.includes(value as CustomModelApi);
}

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  CirclePlus,
  Cpu,
  Eye,
  EyeOff,
  FolderCog,
  Gauge,
  KeyRound,
  Menu,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import type { ModelSummary, RuntimeBootstrap, StellaDesktopApi } from "@shared/contracts";
import type {
  PiCustomProviderConfiguration,
  PiApiKeyRevealResult,
  PiModelConfigurationProviderInput,
  PiModelConfigurationSnapshot,
  PiModelConnectionTestResult,
  PiModelProviderSummary,
} from "@shared/model-configuration";
import { ProviderConfigurationDialog } from "./ProviderConfigurationDialog";

interface ModelConfigurationWorkspaceProps {
  readonly api: StellaDesktopApi;
  readonly bootstrap?: RuntimeBootstrap;
  readonly online: boolean;
  readonly modelChanging: boolean;
  readonly onOpenSidebar: () => void;
  readonly onModelChange: (model: ModelSummary) => Promise<void>;
  readonly onRuntimeRefresh: () => Promise<RuntimeBootstrap>;
  readonly onNotify: (message: string, type: "success" | "error" | "info" | "warning") => void;
}

interface ProviderEditorState {
  readonly provider?: PiCustomProviderConfiguration;
  readonly initialId?: string;
  readonly builtIn: boolean;
}

function modelKey(model: Pick<ModelSummary, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

function authSourceLabel(provider: PiModelProviderSummary): string {
  if (!provider.configured) return "未配置凭据";
  if (provider.credentialType === "oauth") return "OAuth 已配置";
  if (provider.credentialType === "api_key" || provider.authSource === "stored") return "auth.json";
  if (provider.authSource === "models_json_key") return "models.json";
  if (provider.authSource === "environment") return provider.authLabel ?? "环境变量";
  return provider.authLabel ?? provider.authSource ?? "已配置";
}

function contextLabel(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

export function ModelConfigurationWorkspace({
  api,
  bootstrap,
  online,
  modelChanging,
  onOpenSidebar,
  onModelChange,
  onRuntimeRefresh,
  onNotify,
}: ModelConfigurationWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<PiModelConfigurationSnapshot>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState(bootstrap?.state.model?.provider ?? "");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [revealedApiKey, setRevealedApiKey] = useState<PiApiKeyRevealResult>();
  const [revealingApiKey, setRevealingApiKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<PiModelConnectionTestResult>();
  const [testModelId, setTestModelId] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [editorState, setEditorState] = useState<ProviderEditorState>();
  const selectedProviderIdRef = useRef(selectedProviderId);
  const revealRequestRef = useRef(0);
  const connectionRequestRef = useRef(0);

  const clearProviderDiagnostics = () => {
    revealRequestRef.current += 1;
    connectionRequestRef.current += 1;
    setApiKey("");
    setShowApiKey(false);
    setRevealedApiKey(undefined);
    setRevealingApiKey(false);
    setTestingConnection(false);
    setConnectionResult(undefined);
    setTestModelId("");
  };

  const selectProvider = (providerId: string) => {
    if (providerId === selectedProviderIdRef.current || testingConnection || Boolean(busyAction)) return;
    selectedProviderIdRef.current = providerId;
    clearProviderDiagnostics();
    setSelectedProviderId(providerId);
  };

  const load = async () => {
    clearProviderDiagnostics();
    setLoading(true);
    setLoadError("");
    try {
      const next = await api.modelConfigurationInitialize();
      setSnapshot(next);
      setSelectedProviderId((current) => current || bootstrap?.state.model?.provider || next.providers.find((provider) => provider.configured)?.id || next.providers[0]?.id || "");
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    selectedProviderIdRef.current = selectedProviderId;
    revealRequestRef.current += 1;
    connectionRequestRef.current += 1;
    setApiKey("");
    setShowApiKey(false);
    setRevealedApiKey(undefined);
    setRevealingApiKey(false);
    setTestingConnection(false);
    setConnectionResult(undefined);
    setTestModelId("");
  }, [selectedProviderId]);

  useEffect(() => {
    if (!revealedApiKey) return undefined;
    const timeout = window.setTimeout(() => setRevealedApiKey(undefined), 30_000);
    return () => window.clearTimeout(timeout);
  }, [revealedApiKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void api.modelConfigurationInitialize().then((next) => {
      if (!active) return;
      setSnapshot(next);
      setSelectedProviderId((current) => current || bootstrap?.state.model?.provider || next.providers.find((provider) => provider.configured)?.id || next.providers[0]?.id || "");
    }).catch((cause: unknown) => {
      if (active) setLoadError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [api, bootstrap?.state.model?.provider]);

  const providers = useMemo(() => {
    const query = providerQuery.trim().toLocaleLowerCase();
    return (snapshot?.providers ?? []).filter((provider) => !query || `${provider.name} ${provider.id}`.toLocaleLowerCase().includes(query));
  }, [providerQuery, snapshot?.providers]);
  const selectedProvider = snapshot?.providers.find((provider) => provider.id === selectedProviderId);
  const customProvider = snapshot?.customProviders.find((provider) => provider.id === selectedProviderId);
  const providerModels = useMemo(() => (
    (bootstrap?.models ?? []).filter((model) => model.provider === selectedProviderId)
  ), [bootstrap?.models, selectedProviderId]);
  const models = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    return providerModels.filter((model) => !query || `${model.name} ${model.id}`.toLocaleLowerCase().includes(query));
  }, [modelQuery, providerModels]);
  const selectedModelKey = bootstrap?.state.model ? modelKey(bootstrap.state.model) : "";
  const currentModel = bootstrap?.models.find((model) => modelKey(model) === selectedModelKey);
  const testModels = useMemo(() => {
    const options = new Map<string, string>();
    if (currentModel?.provider === selectedProviderId) options.set(currentModel.id, currentModel.name || currentModel.id);
    for (const model of providerModels) options.set(model.id, model.name || model.id);
    for (const model of customProvider?.models ?? []) options.set(model.id, model.name || model.id);
    if (connectionResult?.providerId === selectedProviderId && connectionResult.modelId) {
      options.set(connectionResult.modelId, options.get(connectionResult.modelId) ?? connectionResult.modelId);
    }
    return [...options].map(([id, name]) => Object.freeze({ id, name }));
  }, [connectionResult?.modelId, connectionResult?.providerId, currentModel, customProvider?.models, providerModels, selectedProviderId]);
  const effectiveTestModelId = testModels.some((model) => model.id === testModelId)
    ? testModelId
    : testModels[0]?.id ?? "";

  const mutate = async (
    label: string,
    action: () => Promise<PiModelConfigurationSnapshot>,
    successMessage: string | ((next: PiModelConfigurationSnapshot) => string),
  ) => {
    setBusyAction(label);
    try {
      const next = await action();
      setSnapshot(next);
      await onRuntimeRefresh();
      onNotify(typeof successMessage === "function" ? successMessage(next) : successMessage, "success");
      return next;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      onNotify(`${label}失败：${message}`, "error");
      throw cause;
    } finally {
      setBusyAction("");
    }
  };

  const saveApiKey = async () => {
    if (!selectedProvider || !apiKey.trim()) return;
    await mutate(
      "保存 API key",
      () => api.modelConfigurationSaveApiKey({ providerId: selectedProvider.id, apiKey }),
      `${selectedProvider.name} 凭据已保存，Pi 模型目录已重载`,
    );
    setApiKey("");
    setShowApiKey(false);
    setRevealedApiKey(undefined);
    setConnectionResult(undefined);
  };

  const revealCurrentApiKey = async () => {
    if (!selectedProvider) return;
    if (revealedApiKey?.providerId === selectedProvider.id) {
      revealRequestRef.current += 1;
      setRevealedApiKey(undefined);
      return;
    }
    const providerId = selectedProvider.id;
    const request = ++revealRequestRef.current;
    setRevealingApiKey(true);
    try {
      const result = await api.modelConfigurationRevealApiKey(providerId);
      if (request !== revealRequestRef.current || selectedProviderIdRef.current !== providerId) return;
      setRevealedApiKey(result);
    } catch (cause) {
      if (request !== revealRequestRef.current || selectedProviderIdRef.current !== providerId) return;
      onNotify(`读取 ${selectedProvider.name} API Key 失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
    } finally {
      if (request === revealRequestRef.current && selectedProviderIdRef.current === providerId) setRevealingApiKey(false);
    }
  };

  const testConnection = async () => {
    if (!selectedProvider) return;
    const providerId = selectedProvider.id;
    const request = ++connectionRequestRef.current;
    setTestingConnection(true);
    setConnectionResult(undefined);
    const requestedModelId = effectiveTestModelId;
    if (requestedModelId) setTestModelId(requestedModelId);
    const draftApiKey = apiKey.trim() ? apiKey : undefined;
    try {
      const result = await api.modelConfigurationTestConnection({
        providerId,
        ...(requestedModelId ? { modelId: requestedModelId } : {}),
        ...(draftApiKey ? { apiKey: draftApiKey } : {}),
      });
      if (request !== connectionRequestRef.current || selectedProviderIdRef.current !== providerId) return;
      setConnectionResult(result);
      if (result.modelId) setTestModelId(result.modelId);
      onNotify(
        result.ok
          ? `${selectedProvider.name} / ${result.modelId ?? "模型"} 连通测试成功（${result.latencyMs} ms）`
          : `${selectedProvider.name} 连通测试失败：${result.message}`,
        result.ok ? "success" : "error",
      );
    } catch (cause) {
      if (request !== connectionRequestRef.current || selectedProviderIdRef.current !== providerId) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setConnectionResult(Object.freeze({
        ok: false,
        code: "unknown",
        providerId,
        modelId: requestedModelId || undefined,
        latencyMs: 0,
        checkedAt: Date.now(),
        message,
      }));
      onNotify(`${selectedProvider.name} 连通测试失败：${message}`, "error");
    } finally {
      if (request === connectionRequestRef.current && selectedProviderIdRef.current === providerId) setTestingConnection(false);
    }
  };

  const clearStoredCredential = async () => {
    if (!selectedProvider) return;
    await mutate(
      "清除凭据",
      () => api.modelConfigurationDeleteCredential(selectedProvider.id),
      (next) => {
        const provider = next.providers.find((candidate) => candidate.id === selectedProvider.id);
        return provider?.configured
          ? `${selectedProvider.name} 的 auth.json 凭据已清除；当前仍由 ${authSourceLabel(provider)} 提供凭据`
          : `${selectedProvider.name} 的 auth.json 凭据已清除`;
      },
    );
    clearProviderDiagnostics();
  };

  const saveProvider = async (input: PiModelConfigurationProviderInput) => {
    await mutate(
      "保存 Provider",
      () => api.modelConfigurationUpsertProvider(input),
      `${input.name ?? input.id} 配置已应用`,
    );
    clearProviderDiagnostics();
    selectedProviderIdRef.current = input.id;
    setSelectedProviderId(input.id);
  };

  const deleteProvider = async (providerId: string) => {
    await mutate(
      "移除 Provider 配置",
      () => api.modelConfigurationDeleteProvider(providerId),
      `${providerId} 的 models.json 配置已移除`,
    );
    clearProviderDiagnostics();
  };

  return (
    <main className="model-configuration-workspace">
      <header className="model-config-header">
        <button type="button" className="icon-button model-config-header__menu" aria-label="打开侧栏" onClick={onOpenSidebar}><Menu size={18} /></button>
        <div className="model-config-header__identity"><span><BrainCircuit size={16} /></span><div><small>PI MODEL ROUTER</small><h1>模型配置</h1></div></div>
        <div className="model-config-header__actions">
          <span className={`model-runtime-state ${online ? "is-online" : ""}`}><i />{online ? "PI RUNTIME ONLINE" : "PI RUNTIME OFFLINE"}</span>
          <button type="button" className="button-secondary" disabled={loading || testingConnection || Boolean(busyAction)} onClick={() => void load()}><RefreshCw size={14} className={loading ? "spin" : ""} />刷新</button>
          <button type="button" className="button-secondary" disabled={!snapshot} onClick={() => snapshot && void api.revealPath(snapshot.agentDir).catch((cause: unknown) => onNotify(`打开 Pi 配置目录失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"))}><FolderCog size={14} />配置目录</button>
          <button type="button" className="button-primary" disabled={testingConnection || Boolean(busyAction)} onClick={() => setEditorState({ builtIn: false })}><CirclePlus size={14} />自定义 Provider</button>
        </div>
      </header>

      <section className="model-route-strip" aria-label="当前模型路由">
        <div className="model-route-strip__lead"><Workflow size={17} /><span><small>ACTIVE ROUTE</small><strong>全局模型信号链</strong></span></div>
        <div className="model-route-node"><small>PROVIDER</small><strong>{bootstrap?.state.model?.provider ?? "未连接"}</strong></div><i />
        <div className="model-route-node"><small>MODEL</small><strong>{currentModel?.name ?? bootstrap?.state.model?.id ?? "未选择"}</strong></div><i />
        <div className="model-route-node"><small>CONTEXT</small><strong>{currentModel ? contextLabel(currentModel.contextWindow) : "—"}</strong></div><i />
        <div className="model-route-node model-route-node--final"><small>SCOPE</small><strong>会话 / 团队 / 看板</strong><span>Agent 显式设置优先</span></div>
      </section>

      {snapshot?.configurationError && <section className="model-config-alert" role="alert"><strong>Pi 模型配置存在错误</strong><pre>{snapshot.configurationError}</pre><button type="button" className="button-secondary" onClick={() => void api.revealPath(snapshot.modelsPath)}>在文件夹中查看</button></section>}
      {loadError && <section className="model-config-alert" role="alert"><strong>无法读取 Pi 模型配置</strong><p>{loadError}</p><button type="button" className="button-secondary" onClick={() => void load()}>重试</button></section>}

      <div className="model-config-grid">
        <aside className="provider-rail" aria-label="Provider 列表">
          <header><div><small>PROVIDER BUS</small><strong>连接源</strong></div><span>{snapshot?.providers.filter((provider) => provider.configured).length ?? 0}/{snapshot?.providers.length ?? 0}</span></header>
          <label className="model-search"><Search size={14} /><input aria-label="搜索 Provider" value={providerQuery} onChange={(event) => setProviderQuery(event.target.value)} placeholder="搜索 Provider" /></label>
          <div className="provider-rail__list">
            {loading && !snapshot ? <div className="model-config-loading"><span /><span /><span /><p>读取 Pi catalog…</p></div> : providers.map((provider) => (
              <button type="button" key={provider.id} className={provider.id === selectedProviderId ? "is-selected" : ""} aria-pressed={provider.id === selectedProviderId} disabled={(testingConnection || Boolean(busyAction)) && provider.id !== selectedProviderId} onClick={() => selectProvider(provider.id)}>
                <span className="provider-rail__glyph">{provider.name.slice(0, 1).toLocaleUpperCase()}<i className={provider.configured ? "is-online" : ""} /></span>
                <span className="provider-rail__copy"><strong>{provider.name}</strong><small>{provider.id} · {provider.catalogModelCount} models</small></span>
                {provider.hasCustomConfiguration && <em>CUSTOM</em>}
              </button>
            ))}
            {!loading && providers.length === 0 && <p className="provider-rail__empty">没有匹配的 Provider</p>}
          </div>
        </aside>

        <section className="model-catalog" aria-label="可用模型目录">
          <header className="model-catalog__header">
            <div><small>AVAILABLE MODELS</small><h2>{selectedProvider?.name ?? "选择 Provider"}</h2><p>{selectedProvider?.configured ? "Pi 已发现本地凭据配置；真实可用性请在右侧发起连接测试。" : "配置 Provider 凭据后，Pi 才会把模型加入可选目录。"}</p></div>
            <label className="model-search model-search--catalog"><Search size={14} /><input aria-label="搜索可用模型" value={modelQuery} onChange={(event) => setModelQuery(event.target.value)} placeholder="按模型 ID 或名称筛选" /></label>
          </header>
          <div className="model-catalog__list">
            {models.map((model, index) => {
              const selected = modelKey(model) === selectedModelKey;
              return <article className={`model-catalog-row ${selected ? "is-selected" : ""}`} key={modelKey(model)}>
                <span className="model-catalog-row__index">{String(index + 1).padStart(2, "0")}</span>
                <span className="model-catalog-row__mark"><Cpu size={16} />{selected && <Check size={10} />}</span>
                <div className="model-catalog-row__identity"><strong>{model.name || model.id}</strong><small>{model.id}</small></div>
                <span className="model-catalog-row__metric"><Gauge size={12} /><small>CONTEXT</small><strong>{contextLabel(model.contextWindow)}</strong></span>
                <span className="model-catalog-row__metric"><Sparkles size={12} /><small>REASONING</small><strong>{model.reasoning ? "YES" : "STANDARD"}</strong></span>
                <button type="button" className={selected ? "button-secondary" : "button-primary"} disabled={selected || modelChanging || !online} onClick={() => void onModelChange(model)}>{modelChanging && !selected ? "等待" : selected ? "当前模型" : "设为全局"}</button>
              </article>;
            })}
            {selectedProvider && models.length === 0 && (
              <div className="model-catalog__empty"><BrainCircuit size={25} /><strong>{selectedProvider.configured ? "Pi 没有返回可用模型" : "Provider 尚未接入信号链"}</strong><p>{selectedProvider.configured ? "请检查 models.json、Provider catalog 或刷新错误。" : "在右侧保存 API key，或通过 Pi CLI 完成 OAuth 登录。"}</p></div>
            )}
          </div>
        </section>

        <aside className="provider-console" aria-label="Provider 配置台">
          {selectedProvider ? <>
            <header><span className="provider-console__emblem">{selectedProvider.name.slice(0, 2).toLocaleUpperCase()}</span><div><small>CONNECTION INSPECTOR</small><h2>{selectedProvider.name}</h2><code>{selectedProvider.id}</code></div></header>
            <div className={`provider-console__status ${selectedProvider.configured ? "is-online" : ""} ${connectionResult?.ok ? "is-verified" : connectionResult ? "is-error" : ""}`}>
              <span><i />{connectionResult?.ok ? "CONNECTION VERIFIED" : connectionResult ? "CHECK FAILED" : selectedProvider.configured ? "CREDENTIAL READY" : "NOT CONFIGURED"}</span>
              <strong>{connectionResult?.ok ? `${connectionResult.modelId ?? "model"} · ${connectionResult.latencyMs} ms` : authSourceLabel(selectedProvider)}</strong>
            </div>
            <dl className="provider-console__facts">
              <div><dt>目录模型</dt><dd>{selectedProvider.catalogModelCount}</dd></div>
              <div><dt>API Key</dt><dd>{selectedProvider.supportsApiKey ? "支持" : "不支持"}</dd></div>
              <div><dt>OAuth</dt><dd>{selectedProvider.supportsOAuth ? "支持" : "—"}</dd></div>
              <div><dt>来源</dt><dd>{selectedProvider.builtIn ? "Pi 内置" : "自定义"}</dd></div>
            </dl>

            <section className={`provider-connection-test ${connectionResult?.ok ? "is-success" : connectionResult ? "is-error" : ""}`} aria-label={`${selectedProvider.name} 连通测试`} aria-busy={testingConnection}>
              <header><Gauge size={14} /><span><strong>真实模型请求</strong><small id="provider-connection-cost-hint">独立发送极短请求，不写入聊天记录；可能产生少量 Token 费用。</small></span></header>
              <div className="provider-connection-test__controls">
                <label><span>测试模型</span><select aria-label="连接测试模型" value={effectiveTestModelId} disabled={testingConnection || testModels.length === 0} onChange={(event) => { setTestModelId(event.target.value); setConnectionResult(undefined); }}>
                  {testModels.length === 0 && <option value="">使用 Pi 目录首个模型</option>}
                  {testModels.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}
                </select></label>
                <button type="button" className="button-secondary" aria-label={`测试 ${selectedProvider.name} 连通性`} aria-describedby="provider-connection-cost-hint" disabled={testingConnection || Boolean(busyAction)} onClick={() => void testConnection()}><RefreshCw size={13} className={testingConnection ? "spin" : ""} />{testingConnection ? "正在请求…" : "测试连通性"}</button>
              </div>
              <p className="provider-connection-test__hint">{apiKey.trim() ? "本次测试使用输入框中的新 Key，不会保存。" : "输入框为空：本次测试使用 Pi 当前解析到的凭据。"}</p>
              {connectionResult && <div className={`provider-connection-result ${connectionResult.ok ? "is-success" : "is-error"}`} role={connectionResult.ok ? "status" : "alert"}>
                <span>{connectionResult.ok ? <Check size={13} /> : <EyeOff size={13} />}</span>
                <div><strong>{connectionResult.ok ? "连通已验证" : "测试未通过"}</strong><p>{connectionResult.message}</p><small>{connectionResult.modelId ?? "未选择模型"} · {connectionResult.latencyMs} ms · {new Date(connectionResult.checkedAt).toLocaleTimeString()}</small></div>
              </div>}
            </section>

            {selectedProvider.supportsApiKey && <section className="provider-key-panel" aria-busy={revealingApiKey}>
              <div><KeyRound size={14} /><span><strong>{selectedProvider.configured ? "查看或替换 API key" : "连接 API key"}</strong><small>{selectedProvider.credentialType === "oauth" ? "当前为 OAuth；访问令牌不会显示。输入新 Key 可先测试，再明确替换。" : "当前值只在点击查看后临时读取；动态 !command 不会因查看而执行。"}</small></span></div>
              {selectedProvider.configured && selectedProvider.credentialType !== "oauth" && <div className="provider-saved-key">
                <span><strong>当前凭据</strong><small>{revealedApiKey?.source ?? authSourceLabel(selectedProvider)} · 显示后 30 秒自动清除</small></span>
                <label><input aria-label={`${selectedProvider.name} 当前 API key`} readOnly type={revealedApiKey ? "text" : "password"} autoComplete="off" value={revealedApiKey?.apiKey ?? ""} placeholder="已配置，点击查看" /></label>
                <button type="button" className="button-secondary" aria-label={revealedApiKey ? "隐藏当前 API key" : "查看当前 API key"} disabled={revealingApiKey || testingConnection || Boolean(busyAction)} onClick={() => void revealCurrentApiKey()}>{revealedApiKey ? <EyeOff size={13} /> : <Eye size={13} />}{revealingApiKey ? "读取中…" : revealedApiKey ? "隐藏" : "查看"}</button>
              </div>}
              <label className="provider-key-panel__draft"><input aria-label={`${selectedProvider.name} API key`} type={showApiKey ? "text" : "password"} autoComplete="new-password" autoCapitalize="off" spellCheck={false} disabled={testingConnection} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setConnectionResult(undefined); }} placeholder={selectedProvider.configured ? "粘贴新的 API key（不会覆盖当前值，直到保存）" : "粘贴新的 API key"} /><button type="button" aria-label={showApiKey ? "隐藏新 API key" : "显示新 API key"} disabled={!apiKey || testingConnection} onClick={() => setShowApiKey((current) => !current)}>{showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></label>
              <button type="button" className="button-primary" disabled={!apiKey.trim() || Boolean(busyAction) || testingConnection} onClick={() => void saveApiKey().catch(() => undefined)}><ShieldCheck size={13} />{busyAction === "保存 API key" ? "保存并重载 Pi…" : "安全保存并应用"}</button>
              {selectedProvider.credentialType && <button type="button" className="provider-key-panel__delete" disabled={Boolean(busyAction) || testingConnection} onClick={() => {
                if (!window.confirm(`确认清除 ${selectedProvider.name} 在 auth.json 中保存的凭据？`)) return;
                void clearStoredCredential().catch(() => undefined);
              }}><Trash2 size={12} />清除已保存凭据</button>}
            </section>}

            {selectedProvider.supportsOAuth && <p className="provider-console__oauth"><KeyRound size={13} /><span><strong>OAuth / 订阅登录</strong><small>由 Pi 的交互式 <code>/login {selectedProvider.id}</code> 流程管理；本页只显示状态，不读取令牌。</small></span></p>}

            <section className="provider-console__custom">
              <div><Pencil size={13} /><span><strong>{customProvider ? "models.json 覆盖已启用" : "端点与模型覆盖"}</strong><small>{customProvider ? `${customProvider.models.length} 个自定义模型；高级字段会保留。` : "配置代理、Ollama、LM Studio、vLLM 或模型覆盖。"}</small></span></div>
              <button type="button" className="button-secondary" disabled={testingConnection || Boolean(busyAction)} onClick={() => setEditorState({ provider: customProvider, initialId: customProvider ? undefined : selectedProvider.id, builtIn: selectedProvider.builtIn })}>{customProvider ? "编辑配置" : "创建覆盖"}</button>
            </section>
            <footer><ShieldCheck size={13} /><span>初始化与刷新永不返回密钥；只有点击“查看”才通过独立 IPC 临时读取，切换 Provider、保存、隐藏或 30 秒后立即从页面清除。</span></footer>
          </> : <div className="provider-console__empty"><Cpu size={24} /><p>从左侧选择一个 Provider</p></div>}
        </aside>
      </div>

      {editorState !== undefined && (
        <ProviderConfigurationDialog
          provider={editorState.provider}
          initialId={editorState.initialId}
          builtIn={editorState.builtIn}
          busy={Boolean(busyAction)}
          onClose={() => setEditorState(undefined)}
          onSave={saveProvider}
          onDelete={deleteProvider}
        />
      )}
    </main>
  );
}

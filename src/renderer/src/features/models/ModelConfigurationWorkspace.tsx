import { useEffect, useMemo, useState } from "react";
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
  PiModelConfigurationProviderInput,
  PiModelConfigurationSnapshot,
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
  if (!provider.configured) return "等待连接";
  if (provider.credentialType === "oauth") return "OAuth 已连接";
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
  const [busyAction, setBusyAction] = useState("");
  const [editorState, setEditorState] = useState<ProviderEditorState>();

  const load = async () => {
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
  const models = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    return (bootstrap?.models ?? []).filter((model) =>
      model.provider === selectedProviderId && (!query || `${model.name} ${model.id}`.toLocaleLowerCase().includes(query)),
    );
  }, [bootstrap?.models, modelQuery, selectedProviderId]);
  const selectedModelKey = bootstrap?.state.model ? modelKey(bootstrap.state.model) : "";
  const currentModel = bootstrap?.models.find((model) => modelKey(model) === selectedModelKey);

  const mutate = async (
    label: string,
    action: () => Promise<PiModelConfigurationSnapshot>,
    successMessage: string,
  ) => {
    setBusyAction(label);
    try {
      const next = await action();
      setSnapshot(next);
      await onRuntimeRefresh();
      onNotify(successMessage, "success");
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
      `${selectedProvider.name} 已连接，Pi 模型目录已重载`,
    );
    setApiKey("");
  };

  const saveProvider = async (input: PiModelConfigurationProviderInput) => {
    await mutate(
      "保存 Provider",
      () => api.modelConfigurationUpsertProvider(input),
      `${input.name ?? input.id} 配置已应用`,
    );
    setSelectedProviderId(input.id);
  };

  const deleteProvider = async (providerId: string) => {
    await mutate(
      "移除 Provider 配置",
      () => api.modelConfigurationDeleteProvider(providerId),
      `${providerId} 的 models.json 配置已移除`,
    );
  };

  return (
    <main className="model-configuration-workspace">
      <header className="model-config-header">
        <button type="button" className="icon-button model-config-header__menu" aria-label="打开侧栏" onClick={onOpenSidebar}><Menu size={18} /></button>
        <div className="model-config-header__identity"><span><BrainCircuit size={16} /></span><div><small>PI MODEL ROUTER</small><h1>模型配置</h1></div></div>
        <div className="model-config-header__actions">
          <span className={`model-runtime-state ${online ? "is-online" : ""}`}><i />{online ? "PI RUNTIME ONLINE" : "PI RUNTIME OFFLINE"}</span>
          <button type="button" className="button-secondary" disabled={loading} onClick={() => void load()}><RefreshCw size={14} className={loading ? "is-spinning" : ""} />刷新</button>
          <button type="button" className="button-secondary" disabled={!snapshot} onClick={() => snapshot && void api.revealPath(snapshot.agentDir).catch((cause: unknown) => onNotify(`打开 Pi 配置目录失败：${cause instanceof Error ? cause.message : String(cause)}`, "error"))}><FolderCog size={14} />配置目录</button>
          <button type="button" className="button-primary" onClick={() => setEditorState({ builtIn: false })}><CirclePlus size={14} />自定义 Provider</button>
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
              <button type="button" key={provider.id} className={provider.id === selectedProviderId ? "is-selected" : ""} onClick={() => { setSelectedProviderId(provider.id); setApiKey(""); }}>
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
            <div><small>AVAILABLE MODELS</small><h2>{selectedProvider?.name ?? "选择 Provider"}</h2><p>{selectedProvider?.configured ? "已通过 Pi 鉴权检查，可直接切换为全局模型。" : "连接 Provider 后，Pi 才会把模型加入可选目录。"}</p></div>
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
            <div className={`provider-console__status ${selectedProvider.configured ? "is-online" : ""}`}><span><i />{selectedProvider.configured ? "CONNECTED" : "NOT CONFIGURED"}</span><strong>{authSourceLabel(selectedProvider)}</strong></div>
            <dl className="provider-console__facts">
              <div><dt>目录模型</dt><dd>{selectedProvider.catalogModelCount}</dd></div>
              <div><dt>API Key</dt><dd>{selectedProvider.supportsApiKey ? "支持" : "不支持"}</dd></div>
              <div><dt>OAuth</dt><dd>{selectedProvider.supportsOAuth ? "支持" : "—"}</dd></div>
              <div><dt>来源</dt><dd>{selectedProvider.builtIn ? "Pi 内置" : "自定义"}</dd></div>
            </dl>

            {selectedProvider.supportsApiKey && <section className="provider-key-panel">
              <div><KeyRound size={14} /><span><strong>{selectedProvider.configured ? "替换 API key" : "连接 API key"}</strong><small>{selectedProvider.credentialType === "oauth" ? "保存新密钥将明确替换当前 OAuth 凭据；已有令牌不会回显。" : "已有值永不回显；新值只发送到 Electron 主进程。"}</small></span></div>
              <label><input aria-label={`${selectedProvider.name} API key`} type={showApiKey ? "text" : "password"} autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="粘贴新的 API key" /><button type="button" aria-label={showApiKey ? "隐藏 API key" : "显示 API key"} onClick={() => setShowApiKey((current) => !current)}>{showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></label>
              <button type="button" className="button-primary" disabled={!apiKey.trim() || Boolean(busyAction)} onClick={() => void saveApiKey()}><ShieldCheck size={13} />{busyAction === "保存 API key" ? "保存并重载 Pi…" : "安全保存并应用"}</button>
              {selectedProvider.credentialType && <button type="button" className="provider-key-panel__delete" disabled={Boolean(busyAction)} onClick={() => {
                if (!window.confirm(`确认清除 ${selectedProvider.name} 在 auth.json 中保存的凭据？`)) return;
                void mutate("清除凭据", () => api.modelConfigurationDeleteCredential(selectedProvider.id), `${selectedProvider.name} 的已保存凭据已清除`);
              }}><Trash2 size={12} />清除已保存凭据</button>}
            </section>}

            {selectedProvider.supportsOAuth && <p className="provider-console__oauth"><KeyRound size={13} /><span><strong>OAuth / 订阅登录</strong><small>由 Pi 的交互式 <code>/login {selectedProvider.id}</code> 流程管理；本页只显示状态，不读取令牌。</small></span></p>}

            <section className="provider-console__custom">
              <div><Pencil size={13} /><span><strong>{customProvider ? "models.json 覆盖已启用" : "端点与模型覆盖"}</strong><small>{customProvider ? `${customProvider.models.length} 个自定义模型；高级字段会保留。` : "配置代理、Ollama、LM Studio、vLLM 或模型覆盖。"}</small></span></div>
              <button type="button" className="button-secondary" onClick={() => setEditorState({ provider: customProvider, initialId: customProvider ? undefined : selectedProvider.id, builtIn: selectedProvider.builtIn })}>{customProvider ? "编辑配置" : "创建覆盖"}</button>
            </section>
            <footer><ShieldCheck size={13} /><span>密钥写入 <code>auth.json</code>，权限限制为当前用户；页面和 IPC 返回值不包含密钥。</span></footer>
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

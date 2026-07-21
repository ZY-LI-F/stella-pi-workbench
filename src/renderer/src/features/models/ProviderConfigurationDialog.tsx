import { useState, type FormEvent } from "react";
import { CirclePlus, Cpu, ShieldCheck, Trash2, X } from "lucide-react";
import {
  CUSTOM_MODEL_APIS,
  type CustomModelApi,
  type PiCustomProviderConfiguration,
  type PiModelConfigurationModel,
  type PiModelConfigurationProviderInput,
} from "@shared/model-configuration";
import { Modal } from "../../components/Modal";

interface ProviderConfigurationDialogProps {
  readonly provider?: PiCustomProviderConfiguration;
  readonly initialId?: string;
  readonly builtIn: boolean;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: (input: PiModelConfigurationProviderInput) => Promise<void>;
  readonly onDelete: (providerId: string) => Promise<void>;
}

interface EditableModel {
  readonly key: string;
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly imageInput: boolean;
  readonly contextWindow: string;
  readonly maxTokens: string;
}

function editableModel(model?: PiModelConfigurationModel): EditableModel {
  return Object.freeze({
    key: crypto.randomUUID(),
    id: model?.id ?? "",
    name: model?.name ?? "",
    reasoning: model?.reasoning ?? false,
    imageInput: model?.imageInput ?? false,
    contextWindow: String(model?.contextWindow ?? 128_000),
    maxTokens: String(model?.maxTokens ?? 16_384),
  });
}

function modelInput(model: EditableModel): PiModelConfigurationModel {
  return Object.freeze({
    id: model.id,
    name: model.name || undefined,
    reasoning: model.reasoning,
    imageInput: model.imageInput,
    contextWindow: Number(model.contextWindow),
    maxTokens: Number(model.maxTokens),
  });
}

export function ProviderConfigurationDialog({
  provider,
  initialId,
  builtIn,
  busy,
  onClose,
  onSave,
  onDelete,
}: ProviderConfigurationDialogProps) {
  const [id, setId] = useState(provider?.id ?? initialId ?? "");
  const [name, setName] = useState(provider?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [api, setApi] = useState<CustomModelApi | "">(provider?.api ?? (builtIn ? "" : "openai-completions"));
  const [authHeader, setAuthHeader] = useState(provider?.authHeader ?? false);
  const [models, setModels] = useState<readonly EditableModel[]>(
    provider?.models.length ? provider.models.map(editableModel) : builtIn ? [] : [editableModel()],
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const updateModel = (key: string, patch: Partial<Omit<EditableModel, "key">>) => {
    setModels((current) => current.map((model) => model.key === key ? Object.freeze({ ...model, ...patch }) : model));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await onSave(Object.freeze({
        id,
        name: name || undefined,
        baseUrl: baseUrl || undefined,
        api: api || undefined,
        authHeader,
        models: Object.freeze(models.map(modelInput)),
      }));
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Modal
      title={provider ? `配置 ${provider.name ?? provider.id}` : "接入自定义 Provider"}
      eyebrow="PI MODEL ROUTE · MODELS.JSON"
      onClose={onClose}
      className="provider-configuration-dialog"
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="provider-editor__intro">
          <span><Cpu size={16} /></span>
          <div>
            <strong>{builtIn ? "内置 Provider 覆盖" : "自定义 OpenAI / Anthropic 兼容端点"}</strong>
            <small>{builtIn ? "留空的字段继续使用 Pi 内置目录；只保存你明确填写的覆盖。" : "Provider ID 保存后不可改名；如需更名，请删除后重新创建。"}</small>
          </div>
        </div>

        {provider?.hasInlineApiKey && (
          <p className="provider-editor__notice"><ShieldCheck size={14} />该 Provider 在 models.json 中已有内联密钥或变量引用。页面不会读取或回显它，保存其它字段时会原样保留。</p>
        )}
        {provider?.hasAdvancedConfiguration && (
          <p className="provider-editor__notice">检测到 headers、compat、modelOverrides 或其它高级字段；本表单不会覆盖这些字段。</p>
        )}

        <div className="provider-editor__row">
          <label className="model-field"><span>Provider ID <i>必填</i></span><input autoFocus={!provider && !initialId} value={id} disabled={Boolean(provider || initialId)} onChange={(event) => setId(event.target.value)} placeholder="例如：ollama" /></label>
          <label className="model-field"><span>显示名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：Ollama Local" /></label>
        </div>
        <label className="model-field"><span>Base URL {!builtIn && <i>必填</i>}</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="http://localhost:11434/v1" /></label>
        <div className="provider-editor__row">
          <label className="model-field"><span>API 协议 {!builtIn && <i>必填</i>}</span><select value={api} onChange={(event) => setApi(event.target.value as CustomModelApi | "")}>
            {builtIn && <option value="">继承 Pi 内置协议</option>}
            {CUSTOM_MODEL_APIS.map((candidate) => <option key={candidate} value={candidate}>{candidate}</option>)}
          </select></label>
          <label className="provider-editor__switch"><input type="checkbox" checked={authHeader} onChange={(event) => setAuthHeader(event.target.checked)} /><span><strong>Bearer Auth Header</strong><small>为兼容端点自动添加 Authorization</small></span></label>
        </div>

        <section className="provider-model-editor">
          <header><div><small>MODEL MAP</small><strong>端点模型</strong></div><button type="button" className="button-secondary" onClick={() => setModels((current) => [...current, editableModel()])}><CirclePlus size={13} />添加模型</button></header>
          {models.length === 0 && <p className="provider-model-editor__empty">没有自定义模型；此配置只覆盖内置 Provider 的连接参数。</p>}
          {models.map((model, index) => (
            <article className="provider-model-row" key={model.key}>
              <span className="provider-model-row__index">{String(index + 1).padStart(2, "0")}</span>
              <label className="model-field"><span>Model ID</span><input value={model.id} onChange={(event) => updateModel(model.key, { id: event.target.value })} placeholder="llama3.1:8b" /></label>
              <label className="model-field"><span>名称</span><input value={model.name} onChange={(event) => updateModel(model.key, { name: event.target.value })} placeholder="可选" /></label>
              <label className="model-field model-field--number"><span>Context</span><input type="number" min="1" value={model.contextWindow} onChange={(event) => updateModel(model.key, { contextWindow: event.target.value })} /></label>
              <label className="model-field model-field--number"><span>Max out</span><input type="number" min="1" value={model.maxTokens} onChange={(event) => updateModel(model.key, { maxTokens: event.target.value })} /></label>
              <div className="provider-model-row__flags">
                <label><input type="checkbox" checked={model.reasoning} onChange={(event) => updateModel(model.key, { reasoning: event.target.checked })} />推理</label>
                <label><input type="checkbox" checked={model.imageInput} onChange={(event) => updateModel(model.key, { imageInput: event.target.checked })} />图像</label>
              </div>
              <button type="button" className="icon-button" aria-label={`删除模型 ${model.id || index + 1}`} onClick={() => setModels((current) => current.filter((candidate) => candidate.key !== model.key))}><X size={14} /></button>
            </article>
          ))}
        </section>

        {error && <p className="model-form-error" role="alert">{error}</p>}
        <div className="modal-actions provider-editor__actions">
          {provider && (!confirmDelete
            ? <button type="button" className="button-danger-soft" onClick={() => setConfirmDelete(true)}><Trash2 size={13} />移除配置</button>
            : <button type="button" className="button-danger-soft" disabled={busy} onClick={() => void onDelete(provider.id).then(onClose).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}><Trash2 size={13} />确认移除</button>)}
          <span />
          <button type="button" className="button-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="button-primary" disabled={busy || !id.trim()}>{busy ? "应用并重载 Pi…" : "保存并应用"}</button>
        </div>
      </form>
    </Modal>
  );
}

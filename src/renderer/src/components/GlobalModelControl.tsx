import { BrainCircuit, ChevronDown } from "lucide-react";
import type { ModelSummary } from "@shared/contracts";

interface SelectedModelIdentity {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
}

interface GlobalModelControlProps {
  readonly models: readonly ModelSummary[];
  readonly selectedModel: SelectedModelIdentity | undefined;
  readonly online: boolean;
  readonly busy: boolean;
  readonly onChange: (model: ModelSummary) => void;
}

function modelKey(model: Pick<ModelSummary, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

export function GlobalModelControl({
  models,
  selectedModel,
  online,
  busy,
  onChange,
}: GlobalModelControlProps) {
  const selectedKey = selectedModel ? modelKey(selectedModel) : "";
  const selectedSummary = models.find((model) => modelKey(model) === selectedKey);
  const selectedName = selectedSummary?.name || selectedModel?.name || selectedModel?.id || "未选择模型";
  const selectedProvider = selectedModel?.provider || "Pi Runtime";
  const disabled = !online || busy || models.length === 0;

  return (
    <section className={`global-model ${online ? "is-online" : "is-offline"} ${busy ? "is-busy" : ""}`} aria-label="全局运行模型">
      <header className="global-model__header">
        <span><i />MODEL RELAY</span>
        <small>{busy ? "切换中" : online ? "全局生效" : "Pi 离线"}</small>
      </header>
      <label className="global-model__selector">
        <span className="global-model__mark"><BrainCircuit size={16} /><i /></span>
        <span className="global-model__copy">
          <small>当前模型 · {selectedProvider}</small>
          <strong title={`${selectedProvider}/${selectedModel?.id ?? "未选择"}`}>{selectedName}</strong>
        </span>
        <select
          aria-label="全局模型"
          value={selectedKey}
          disabled={disabled}
          onChange={(event) => {
            const model = models.find((candidate) => modelKey(candidate) === event.target.value);
            if (model) onChange(model);
          }}
        >
          {!selectedKey && <option value="">未选择模型</option>}
          {selectedKey && !selectedSummary && (
            <option value={selectedKey}>{selectedName} · {selectedProvider}</option>
          )}
          {models.map((model) => (
            <option key={modelKey(model)} value={modelKey(model)}>
              {model.name || model.id} · {model.provider}
            </option>
          ))}
        </select>
        <ChevronDown size={13} />
      </label>
      <p>会话、团队与看板共用；Agent 的显式设置优先。</p>
    </section>
  );
}

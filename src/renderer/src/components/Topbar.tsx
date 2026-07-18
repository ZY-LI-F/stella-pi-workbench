import {
  ChevronDown,
  GitBranch,
  Menu,
  MoonStar,
  ListPlus,
  PanelRight,
  Settings2,
  X,
} from "lucide-react";
import type { ModelSummary, RuntimeBootstrap } from "@shared/contracts";

interface TopbarProps {
  readonly bootstrap: RuntimeBootstrap;
  readonly streaming: boolean;
  readonly compacting: boolean;
  readonly retrying: boolean;
  readonly onOpenSidebar: () => void;
  readonly onToggleInspector: () => void;
  readonly onOpenSettings: () => void;
  readonly onModelChange: (model: ModelSummary) => void;
  readonly onThinkingChange: (level: string) => void;
  readonly onAbortRetry: () => void;
  readonly onSolidifyTask: () => void;
}

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

function activityLabel(streaming: boolean, compacting: boolean, retrying: boolean): string {
  if (compacting) return "正在压缩上下文";
  if (retrying) return "等待重试";
  if (streaming) return "Pi 正在工作";
  return "已就绪";
}

export function Topbar({
  bootstrap,
  streaming,
  compacting,
  retrying,
  onOpenSidebar,
  onToggleInspector,
  onOpenSettings,
  onModelChange,
  onThinkingChange,
  onAbortRetry,
  onSolidifyTask,
}: TopbarProps) {
  const selectedModel = bootstrap.state.model
    ? `${bootstrap.state.model.provider}/${bootstrap.state.model.id}`
    : "";

  return (
    <header className="topbar">
      <div className="topbar__project">
        <button type="button" className="icon-button topbar__menu" aria-label="打开侧栏" onClick={onOpenSidebar}>
          <Menu size={18} />
        </button>
        <div className="project-breadcrumb">
          <span>{bootstrap.project.name}</span>
          {bootstrap.project.branch && <><i>/</i><GitBranch size={13} /><strong>{bootstrap.project.branch}</strong></>}
        </div>
      </div>

      <div className="topbar__controls">
        <button type="button" className="button-secondary topbar__task-bridge" onClick={onSolidifyTask}>
          <ListPlus size={14} /><span>固化为任务</span>
        </button>
        <label className="select-control model-control">
          <span className="sr-only">模型</span>
          <select
            value={selectedModel}
            onChange={(event) => {
              const model = bootstrap.models.find((candidate) => `${candidate.provider}/${candidate.id}` === event.target.value);
              if (model) onModelChange(model);
            }}
          >
            {!selectedModel && <option value="">未选择模型</option>}
            {bootstrap.models.map((model) => (
              <option key={`${model.provider}/${model.id}`} value={`${model.provider}/${model.id}`}>
                {model.name || model.id} · {model.provider}
              </option>
            ))}
          </select>
          <ChevronDown size={13} />
        </label>
        <label className="select-control thinking-control">
          <MoonStar size={13} />
          <span className="sr-only">思考级别</span>
          <select value={bootstrap.state.thinkingLevel} onChange={(event) => onThinkingChange(event.target.value)}>
            {THINKING_LEVELS.map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
          <ChevronDown size={13} />
        </label>
        {retrying ? (
          <button type="button" className="activity-pill is-active" aria-label="停止自动重试" onClick={onAbortRetry}>
            <span />{activityLabel(streaming, compacting, retrying)}<X size={12} />
          </button>
        ) : (
          <span className={`activity-pill ${streaming ? "is-active" : ""}`}>
            <span />{activityLabel(streaming, compacting, retrying)}
          </span>
        )}
        <button type="button" className="icon-button" aria-label="会话检查器" onClick={onToggleInspector}>
          <PanelRight size={17} />
        </button>
        <button type="button" className="icon-button" aria-label="设置" onClick={onOpenSettings}>
          <Settings2 size={17} />
        </button>
      </div>
    </header>
  );
}

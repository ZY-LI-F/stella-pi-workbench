import { useMemo, useState, type CSSProperties } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  CopyPlus,
  FileOutput,
  GitFork,
  LoaderCircle,
  PencilLine,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { RuntimeBootstrap, SessionTreeSummary } from "@shared/contracts";
import type { RuntimeUiState, ToolExecutionState } from "../lib/runtime-state";

interface InspectorProps {
  readonly bootstrap: RuntimeBootstrap;
  readonly open: boolean;
  readonly tools: Readonly<Record<string, ToolExecutionState>>;
  readonly queue: RuntimeUiState["queue"];
  readonly extensionStatuses: RuntimeUiState["extensionStatuses"];
  readonly extensionWidgets: RuntimeUiState["extensionWidgets"];
  readonly onClose: () => void;
  readonly onCompact: () => void;
  readonly onExport: () => void;
  readonly onClone: () => void;
  readonly onRename: () => void;
  readonly onFork: (entryId: string) => void;
}

type InspectorTab = "context" | "activity" | "tree";

function compactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function entrySummary(node: SessionTreeSummary): string {
  const message = node.entry.message;
  if (!message) return node.label || node.entry.type;
  if (!("content" in message)) {
    if (message.role === "branchSummary" || message.role === "compactionSummary") return message.summary.slice(0, 72);
    if (message.role === "bashExecution") return message.command.slice(0, 72);
    return node.entry.type;
  }
  const content = message.content;
  if (typeof content === "string") return content.slice(0, 72);
  if (Array.isArray(content)) {
    const text = content.find((block) => block.type === "text");
    if (text?.type === "text") return text.text.slice(0, 72);
  }
  return `${message.role} · ${node.entry.type}`;
}

function TreeNode({
  node,
  leafId,
  depth,
  onFork,
}: {
  readonly node: SessionTreeSummary;
  readonly leafId: string | null;
  readonly depth: number;
  readonly onFork: (entryId: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isLeaf = node.entry.id === leafId;
  return (
    <div className="tree-node" style={{ "--tree-depth": depth } as CSSProperties}>
      <div className={`tree-node__row ${isLeaf ? "is-leaf" : ""}`}>
        <button type="button" className="tree-node__toggle" onClick={() => setOpen((value) => !value)} disabled={!hasChildren}>
          {hasChildren ? (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />) : <span />}
        </button>
        <span className={`tree-node__dot tree-node__dot--${node.entry.message?.role ?? node.entry.type}`} />
        <span className="tree-node__copy" title={entrySummary(node)}>
          <strong>{node.label || entrySummary(node)}</strong>
          <small>{node.entry.message?.role ?? node.entry.type}</small>
        </span>
        {node.entry.message?.role === "user" && (
          <button type="button" className="tree-node__fork" title="从这里分叉" onClick={() => onFork(node.entry.id)}><GitFork size={12} /></button>
        )}
      </div>
      {open && hasChildren && (
        <div className="tree-node__children">
          {node.children.map((child) => <TreeNode key={child.entry.id} node={child} leafId={leafId} depth={depth + 1} onFork={onFork} />)}
        </div>
      )}
    </div>
  );
}

function ContextPanel({
  bootstrap,
  onCompact,
  onExport,
  onClone,
  onRename,
}: Pick<InspectorProps, "bootstrap" | "onCompact" | "onExport" | "onClone" | "onRename">) {
  const stats = bootstrap.stats;
  const percent = stats.contextUsage?.percent ?? 0;
  return (
    <div className="inspector-panel context-panel">
      <div className="context-meter" style={{ "--context-percent": `${Math.max(0, Math.min(100, percent)) * 3.6}deg` } as CSSProperties}>
        <div><strong>{stats.contextUsage?.percent === null || stats.contextUsage?.percent === undefined ? "—" : `${Math.round(stats.contextUsage.percent)}%`}</strong><span>上下文</span></div>
      </div>
      <div className="context-caption">
        <span>{compactNumber(stats.contextUsage?.tokens)} / {compactNumber(stats.contextUsage?.contextWindow)} tokens</span>
        <small>Pi 会在接近窗口上限时自动压缩</small>
      </div>

      <div className="metric-grid">
        <div><span>输入</span><strong>{compactNumber(stats.tokens.input)}</strong></div>
        <div><span>输出</span><strong>{compactNumber(stats.tokens.output)}</strong></div>
        <div><span>缓存读取</span><strong>{compactNumber(stats.tokens.cacheRead)}</strong></div>
        <div><span>费用</span><strong>${stats.cost.toFixed(3)}</strong></div>
      </div>

      <section className="inspector-section">
        <div className="inspector-section__title"><span>会话</span><small>{bootstrap.state.sessionId.slice(0, 8)}</small></div>
        <button type="button" className="inspector-action" onClick={onRename}><PencilLine size={15} /><span><strong>重命名</strong><small>{bootstrap.state.sessionName || "未命名会话"}</small></span><ChevronRight size={14} /></button>
        <button type="button" className="inspector-action" onClick={onClone}><CopyPlus size={15} /><span><strong>克隆分支</strong><small>复制当前活动分支</small></span><ChevronRight size={14} /></button>
        <button type="button" className="inspector-action" onClick={onExport}><FileOutput size={15} /><span><strong>导出 HTML</strong><small>生成可分享的只读记录</small></span><ChevronRight size={14} /></button>
        <button type="button" className="inspector-action" onClick={onCompact}><Archive size={15} /><span><strong>立即压缩</strong><small>保留重点并释放上下文</small></span><ChevronRight size={14} /></button>
      </section>

      <div className="inspector-signature"><span>Observed by</span><strong>Stella</strong><i /></div>
    </div>
  );
}

function ActivityPanel({
  tools,
  queue,
  extensionStatuses,
  extensionWidgets,
}: Pick<InspectorProps, "tools" | "queue" | "extensionStatuses" | "extensionWidgets">) {
  const toolList = useMemo(() => Object.values(tools).sort((a, b) => b.startedAt - a.startedAt), [tools]);
  return (
    <div className="inspector-panel activity-panel">
      <section className="inspector-section">
        <div className="inspector-section__title"><span>活动轨迹</span><small>{toolList.length} 次工具调用</small></div>
        <div className="activity-timeline">
          {toolList.map((tool) => {
            const Icon = tool.status === "running" ? LoaderCircle : tool.status === "error" ? CircleAlert : Check;
            return (
              <div className={`activity-item activity-item--${tool.status}`} key={tool.id}>
                <span className="activity-item__rail"><Icon size={13} className={tool.status === "running" ? "spin" : ""} /></span>
                <div><strong>{tool.name}</strong><small>{new Date(tool.startedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small></div>
              </div>
            );
          })}
          {toolList.length === 0 && <div className="activity-empty"><Wrench size={18} /><p>工具调用会在这里形成一条可检查的轨迹。</p></div>}
        </div>
      </section>

      {(queue.steering.length > 0 || queue.followUp.length > 0) && (
        <section className="inspector-section">
          <div className="inspector-section__title"><span>消息队列</span><Clock3 size={13} /></div>
          {[...queue.steering.map((message) => ({ mode: "引导", message })), ...queue.followUp.map((message) => ({ mode: "排队", message }))].map((item, index) => (
            <div className="queue-item" key={`${item.mode}-${index}`}><span>{item.mode}</span><p>{item.message}</p></div>
          ))}
        </section>
      )}

      {(Object.keys(extensionStatuses).length > 0 || Object.keys(extensionWidgets).length > 0) && (
        <section className="inspector-section">
          <div className="inspector-section__title"><span>扩展界面</span><Sparkles size={13} /></div>
          {Object.entries(extensionStatuses).map(([key, value]) => <div className="extension-status" key={key}><span>{key}</span><strong>{value}</strong></div>)}
          {Object.entries(extensionWidgets).map(([key, widget]) => <div className="extension-widget" key={key}><strong>{key}</strong><pre>{widget.lines.join("\n")}</pre></div>)}
        </section>
      )}
    </div>
  );
}

export function Inspector({
  bootstrap,
  open,
  tools,
  queue,
  extensionStatuses,
  extensionWidgets,
  onClose,
  onCompact,
  onExport,
  onClone,
  onRename,
  onFork,
}: InspectorProps) {
  const [tab, setTab] = useState<InspectorTab>("context");
  return (
    <aside className={`inspector ${open ? "is-open" : ""}`} aria-hidden={!open} inert={!open}>
      <div className="inspector__header">
        <div><small>SESSION LENS</small><strong>检查器</strong></div>
        <button type="button" className="icon-button" aria-label="关闭检查器" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="inspector-tabs" role="tablist">
        <button type="button" className={tab === "context" ? "is-active" : ""} onClick={() => setTab("context")}>上下文</button>
        <button type="button" className={tab === "activity" ? "is-active" : ""} onClick={() => setTab("activity")}>活动</button>
        <button type="button" className={tab === "tree" ? "is-active" : ""} onClick={() => setTab("tree")}>分支</button>
      </div>
      {tab === "context" && <ContextPanel bootstrap={bootstrap} onCompact={onCompact} onExport={onExport} onClone={onClone} onRename={onRename} />}
      {tab === "activity" && <ActivityPanel tools={tools} queue={queue} extensionStatuses={extensionStatuses} extensionWidgets={extensionWidgets} />}
      {tab === "tree" && (
        <div className="inspector-panel tree-panel">
          <div className="tree-panel__intro"><GitFork size={15} /><p>会话是追加式树结构。可从任一用户消息创建新的独立分支。</p></div>
          <div className="session-tree">
            {bootstrap.tree.map((node) => <TreeNode key={node.entry.id} node={node} leafId={bootstrap.leafId} depth={0} onFork={onFork} />)}
            {bootstrap.tree.length === 0 && <div className="activity-empty"><GitFork size={18} /><p>发送第一条消息后，会话树会出现在这里。</p></div>}
          </div>
        </div>
      )}
    </aside>
  );
}

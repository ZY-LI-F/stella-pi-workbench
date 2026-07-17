import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  FileText,
  GitFork,
  LoaderCircle,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  SerializableContentBlock,
  SerializableMessage,
  StellaDesktopApi,
} from "@shared/contracts";
import type { ToolExecutionState } from "../lib/runtime-state";

interface MessageCardProps {
  readonly api: StellaDesktopApi;
  readonly message: SerializableMessage;
  readonly toolExecutions: Readonly<Record<string, ToolExecutionState>>;
  readonly entryId?: string;
  readonly onFork: (entryId: string) => void;
}

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function textContent(blocks: readonly SerializableContentBlock[]): string {
  return blocks
    .flatMap((block) => {
      if (block.type === "text") return [block.text];
      if (block.type === "thinking") return [block.thinking];
      return [];
    })
    .join("\n");
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function toolHeadline(name: string, args: Readonly<Record<string, unknown>>): string {
  if (name === "bash" && typeof args.command === "string") return args.command;
  const path = args.path ?? args.file_path ?? args.filePath;
  if (typeof path === "string") return path;
  return Object.keys(args).length > 0 ? displayValue(args) : "无参数";
}

function ToolCallCard({
  block,
  execution,
}: {
  readonly block: Extract<SerializableContentBlock, { type: "toolCall" }>;
  readonly execution?: ToolExecutionState;
}) {
  const [expanded, setExpanded] = useState(false);
  const status = execution?.status ?? "running";
  const StatusIcon = status === "running" ? LoaderCircle : status === "error" ? CircleAlert : Check;
  return (
    <div className={`tool-card tool-card--${status}`}>
      <button type="button" className="tool-card__summary" onClick={() => setExpanded((value) => !value)}>
        <span className="tool-card__icon">{block.name === "bash" ? <TerminalSquare size={15} /> : <Wrench size={15} />}</span>
        <span className="tool-card__copy">
          <strong>{block.name}</strong>
          <small>{toolHeadline(block.name, block.arguments)}</small>
        </span>
        <StatusIcon size={14} className={status === "running" ? "spin" : ""} />
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="tool-card__detail">
          <div><span>参数</span><pre>{displayValue(block.arguments)}</pre></div>
          {execution?.partialResult !== undefined && <div><span>实时输出</span><pre>{displayValue(execution.partialResult)}</pre></div>}
          {execution?.result !== undefined && <div><span>结果</span><pre>{displayValue(execution.result)}</pre></div>}
        </div>
      )}
    </div>
  );
}

function ToolResultCard({ message }: { readonly message: Extract<SerializableMessage, { role: "toolResult" }> }) {
  const [expanded, setExpanded] = useState(false);
  const output = textContent(message.content);
  const preview = output.split("\n").slice(0, 2).join(" ").trim() || "工具没有返回文本输出";
  return (
    <div className={`tool-result ${message.isError ? "is-error" : ""}`}>
      <button type="button" onClick={() => setExpanded((value) => !value)}>
        <FileText size={14} />
        <span><strong>{message.toolName} 返回</strong><small>{preview}</small></span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && <pre>{output}</pre>}
    </div>
  );
}

function MarkdownBody({ api, text }: { readonly api: StellaDesktopApi; readonly text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(event) => {
              if (!href) return;
              event.preventDefault();
              void api.openExternal(href);
            }}
          >
            {children}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export function MessageCard({ api, message, toolExecutions, entryId, onFork }: MessageCardProps) {
  const [copied, setCopied] = useState(false);
  if (message.role === "bashExecution") return null;
  if (message.role === "branchSummary" || message.role === "compactionSummary") {
    return (
      <details className="session-summary-card">
        <summary>{message.role === "branchSummary" ? "分支摘要" : "上下文压缩摘要"}<ChevronDown size={14} /></summary>
        <div className="markdown-body"><MarkdownBody api={api} text={message.summary} /></div>
      </details>
    );
  }
  if (message.role === "custom" && !message.display) return null;

  const blocks = Array.isArray(message.content) ? message.content : [];
  const text = typeof message.content === "string" ? message.content : textContent(blocks);
  const thinking = blocks.filter(
    (block): block is Extract<SerializableContentBlock, { type: "thinking" }> => block.type === "thinking",
  );
  const toolCalls = blocks.filter(
    (block): block is Extract<SerializableContentBlock, { type: "toolCall" }> => block.type === "toolCall",
  );
  const images = blocks.filter(
    (block): block is Extract<SerializableContentBlock, { type: "image" }> => block.type === "image",
  );
  const textOnly = blocks
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");

  if (message.role === "toolResult") return <ToolResultCard message={message} />;

  if (message.role === "custom") {
    return (
      <article className="custom-message">
        <span>{message.customType}</span>
        <div className="markdown-body"><MarkdownBody api={api} text={text} /></div>
      </article>
    );
  }

  const copyText = textOnly || text;
  const copy = async () => {
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (message.role === "user") {
    return (
      <article className="message message--user">
        <div className="message__bubble">
          {images.length > 0 && (
            <div className="message-images">
              {images.map((image, index) => (
                <img key={`${image.mimeType}-${index}`} src={`data:${image.mimeType};base64,${image.data}`} alt={`附件 ${index + 1}`} />
              ))}
            </div>
          )}
          {text && <p>{text}</p>}
          <div className="message__meta">
            <span>{formatTime(message.timestamp)}</span>
            {entryId && <button type="button" onClick={() => onFork(entryId)} title="从这里分叉"><GitFork size={13} /> 分叉</button>}
            <button type="button" onClick={() => void copy()} title="复制">{copied ? <Check size={13} /> : <Copy size={13} />}</button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="message message--assistant">
      <div className="assistant-avatar" aria-hidden="true"><span>π</span><i /></div>
      <div className="message__body">
        <div className="message__label">
          <strong>Pi</strong>
          {message.role === "assistant" && <span>{message.provider} / {message.model}</span>}
          <time>{formatTime(message.timestamp)}</time>
        </div>
        {thinking.length > 0 && (
          <details className="thinking-block">
            <summary><span className="thinking-orbit" />推理过程<ChevronDown size={14} /></summary>
            <div>{thinking.map((block, index) => <p key={index}>{block.redacted ? "推理内容已由提供方隐藏" : block.thinking}</p>)}</div>
          </details>
        )}
        {textOnly && <div className="markdown-body"><MarkdownBody api={api} text={textOnly} /></div>}
        {toolCalls.length > 0 && (
          <div className="tool-stack">
            {toolCalls.map((block) => <ToolCallCard key={block.id} block={block} execution={toolExecutions[block.id]} />)}
          </div>
        )}
        {message.role === "assistant" && message.errorMessage && (
          <div className="assistant-error"><CircleAlert size={15} /><span>{message.errorMessage}</span></div>
        )}
        <div className="assistant-actions">
          <button type="button" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "已复制" : "复制"}</button>
          {message.role === "assistant" && message.usage && <span>{message.usage.totalTokens.toLocaleString()} tokens</span>}
        </div>
      </div>
    </article>
  );
}

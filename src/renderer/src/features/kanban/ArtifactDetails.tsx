import { Clipboard, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentArtifact } from "@shared/kanban";

interface ArtifactDetailsProps {
  readonly artifact: AgentArtifact;
  readonly onRevealPath: (path: string) => void;
}

function formatTokens(value: number): string {
  const millions = value / 1_000_000;
  if (millions >= 10) return `${millions.toFixed(1)}M`;
  if (millions >= 1) return `${millions.toFixed(2)}M`;
  if (millions >= 0.01) return `${millions.toFixed(3)}M`;
  return `${millions.toFixed(6)}M`;
}

function formatDuration(startedAt: string | undefined, completedAt: string | undefined): string | undefined {
  if (!startedAt) return undefined;
  const start = Date.parse(startedAt);
  const end = completedAt ? Date.parse(completedAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined;
  const totalSeconds = Math.max(0, Math.round((end - start) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return `${hours}h ${restMinutes}m`;
  }
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function ArtifactDetails({ artifact, onRevealPath }: ArtifactDetailsProps) {
  const duration = formatDuration(artifact.startedAt, artifact.completedAt);
  const usage = [
    artifact.inputTokens !== undefined ? `${formatTokens(artifact.inputTokens)} 输入` : undefined,
    artifact.outputTokens !== undefined ? `${formatTokens(artifact.outputTokens)} 输出` : undefined,
    duration ? `运行 ${duration}` : undefined,
    artifact.cost !== undefined ? `$${artifact.cost.toFixed(4)}` : undefined,
  ].filter((item): item is string => Boolean(item));
  return (
    <details className="artifact-card">
      <summary>{artifact.title}<span>查看产物</span></summary>
      <div className="artifact-card__actions">
        <button type="button" onClick={() => void navigator.clipboard.writeText(artifact.content)}><Clipboard size={12} />复制</button>
        {artifact.sessionPath && <button type="button" onClick={() => onRevealPath(artifact.sessionPath ?? "")}><ExternalLink size={12} />会话文件</button>}
      </div>
      <div className="artifact-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown></div>
      {usage.length > 0 && <footer>{usage.join(" · ")}</footer>}
    </details>
  );
}

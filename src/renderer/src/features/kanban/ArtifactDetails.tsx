import { Clipboard, ExternalLink } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentArtifact } from "@shared/kanban";

interface ArtifactDetailsProps {
  readonly artifact: AgentArtifact;
  readonly onRevealPath: (path: string) => void;
}

export function ArtifactDetails({ artifact, onRevealPath }: ArtifactDetailsProps) {
  return (
    <details className="artifact-card">
      <summary>{artifact.title}<span>查看产物</span></summary>
      <div className="artifact-card__actions">
        <button type="button" onClick={() => void navigator.clipboard.writeText(artifact.content)}><Clipboard size={12} />复制</button>
        {artifact.sessionPath && <button type="button" onClick={() => onRevealPath(artifact.sessionPath ?? "")}><ExternalLink size={12} />会话文件</button>}
      </div>
      <div className="artifact-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown></div>
      {(artifact.inputTokens !== undefined || artifact.outputTokens !== undefined) && (
        <footer>{artifact.inputTokens ?? 0} 输入 · {artifact.outputTokens ?? 0} 输出{artifact.cost !== undefined ? ` · $${artifact.cost.toFixed(4)}` : ""}</footer>
      )}
    </details>
  );
}

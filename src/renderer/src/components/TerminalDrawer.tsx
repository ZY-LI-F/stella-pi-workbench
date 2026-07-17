import { useEffect, useRef, useState } from "react";
import { ChevronRight, CircleAlert, LoaderCircle, Square, TerminalSquare, X } from "lucide-react";

export interface BashResult {
  readonly output: string;
  readonly exitCode: number | null;
  readonly cancelled: boolean;
  readonly truncated: boolean;
  readonly fullOutputPath?: string;
}

interface TerminalEntry {
  readonly id: string;
  readonly command: string;
  readonly startedAt: number;
  readonly result?: BashResult;
  readonly error?: string;
}

interface TerminalDrawerProps {
  readonly open: boolean;
  readonly cwd: string;
  readonly onClose: () => void;
  readonly onRun: (command: string) => Promise<BashResult>;
  readonly onAbort: () => Promise<void>;
  readonly onRevealPath: (path: string) => void;
}

export function TerminalDrawer({ open, cwd, onClose, onRun, onAbort, onRevealPath }: TerminalDrawerProps) {
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<readonly TerminalEntry[]>(Object.freeze([]));
  const [running, setRunning] = useState(false);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 80);
  }, [open]);
  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
  }, [entries]);

  const history = entries.map((entry) => entry.command);
  const run = async () => {
    const trimmed = command.trim();
    if (!trimmed || running) return;
    const id = crypto.randomUUID();
    const initial: TerminalEntry = Object.freeze({ id, command: trimmed, startedAt: Date.now() });
    setEntries((current) => Object.freeze([...current, initial]));
    setCommand("");
    setHistoryIndex(-1);
    setRunning(true);
    try {
      const result = await onRun(trimmed);
      setEntries((current) => Object.freeze(current.map((entry) => entry.id === id ? Object.freeze({ ...entry, result }) : entry)));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEntries((current) => Object.freeze(current.map((entry) => entry.id === id ? Object.freeze({ ...entry, error: message }) : entry)));
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className={`terminal-drawer ${open ? "is-open" : ""}`} aria-hidden={!open} inert={!open}>
      <div className="terminal-drawer__handle" />
      <div className="terminal-drawer__header">
        <div><span className="terminal-icon"><TerminalSquare size={15} /></span><span><strong>本地命令</strong><small>{cwd}</small></span></div>
        <div><span className="context-note">输出会加入下一条提示的上下文</span><button type="button" className="icon-button" aria-label="关闭终端" onClick={onClose}><X size={16} /></button></div>
      </div>
      <div className="terminal-output" ref={outputRef}>
        {entries.length === 0 && <div className="terminal-welcome"><span>Stella shell</span><p>在当前项目目录执行命令。Pi 会在下一条消息中看到结果。</p></div>}
        {entries.map((entry) => (
          <div className="terminal-entry" key={entry.id}>
            <div className="terminal-entry__command"><ChevronRight size={13} /><code>{entry.command}</code><time>{new Date(entry.startedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div>
            {!entry.result && !entry.error && <div className="terminal-entry__running"><LoaderCircle size={13} className="spin" /> 执行中</div>}
            {entry.error && <div className="terminal-entry__error"><CircleAlert size={13} />{entry.error}</div>}
            {entry.result && (
              <div className={`terminal-entry__result ${entry.result.exitCode === 0 ? "is-success" : "is-error"}`}>
                <pre>{entry.result.output || "(没有输出)"}</pre>
                <div><span>exit {String(entry.result.exitCode)}</span>{entry.result.cancelled && <span>已取消</span>}{entry.result.truncated && entry.result.fullOutputPath && <button type="button" onClick={() => onRevealPath(entry.result?.fullOutputPath ?? "")}>查看完整输出</button>}</div>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="terminal-input-row">
        <ChevronRight size={15} />
        <input
          ref={inputRef}
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void run();
            if (event.key === "ArrowUp" && history.length > 0) {
              event.preventDefault();
              const nextIndex = Math.min(historyIndex + 1, history.length - 1);
              setHistoryIndex(nextIndex);
              setCommand(history[history.length - 1 - nextIndex] ?? "");
            }
            if (event.key === "ArrowDown" && historyIndex >= 0) {
              event.preventDefault();
              const nextIndex = historyIndex - 1;
              setHistoryIndex(nextIndex);
              setCommand(nextIndex < 0 ? "" : history[history.length - 1 - nextIndex] ?? "");
            }
            if (event.key === "Escape") onClose();
          }}
          placeholder="输入 PowerShell / shell 命令…"
        />
        {running ? <button type="button" className="terminal-abort" onClick={() => void onAbort()}><Square size={11} fill="currentColor" />停止</button> : <button type="button" className="terminal-run" disabled={!command.trim()} onClick={() => void run()}>运行</button>}
      </div>
    </div>
  );
}

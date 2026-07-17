import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Command,
  FileImage,
  Paperclip,
  Square,
  TerminalSquare,
  X,
} from "lucide-react";
import type { SlashCommandSummary } from "@shared/contracts";
import type { RuntimeUiState } from "../lib/runtime-state";

export interface ComposerImage {
  readonly type: "image";
  readonly data: string;
  readonly mimeType: string;
  readonly name: string;
}

interface ComposerProps {
  readonly draft: string;
  readonly onDraftChange: (draft: string) => void;
  readonly editorInjection?: { readonly id: string; readonly text: string };
  readonly commands: readonly SlashCommandSummary[];
  readonly widgets: RuntimeUiState["extensionWidgets"];
  readonly streaming: boolean;
  readonly queueMode: "steer" | "followUp";
  readonly onQueueModeChange: (mode: "steer" | "followUp") => void;
  readonly onSend: (message: string, images: readonly ComposerImage[]) => Promise<void>;
  readonly onStop: () => void;
  readonly onOpenTerminal: () => void;
  readonly onOpenPalette: () => void;
  readonly onError: (message: string) => void;
}

function fileToImage(file: File): Promise<ComposerImage> {
  if (!file.type.startsWith("image/")) return Promise.reject(new Error(`${file.name} 不是图片文件`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取 ${file.name}`));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`无法读取 ${file.name}: FileReader 未返回 data URL`));
        return;
      }
      const comma = reader.result.indexOf(",");
      if (comma < 0) {
        reject(new Error(`无法读取 ${file.name}: data URL 格式无效`));
        return;
      }
      resolve(Object.freeze({ type: "image", data: reader.result.slice(comma + 1), mimeType: file.type, name: file.name }));
    };
    reader.readAsDataURL(file);
  });
}

export function Composer({
  draft,
  onDraftChange,
  editorInjection,
  commands,
  widgets,
  streaming,
  queueMode,
  onQueueModeChange,
  onSend,
  onStop,
  onOpenTerminal,
  onOpenPalette,
  onError,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<readonly ComposerImage[]>(Object.freeze([]));
  const [sending, setSending] = useState(false);
  const slashQuery = draft.startsWith("/") && !draft.includes("\n") ? draft.slice(1).split(/\s/)[0] ?? "" : null;
  const matchingCommands = useMemo(
    () =>
      slashQuery === null
        ? []
        : commands
            .filter((command) => command.name.toLocaleLowerCase().includes(slashQuery.toLocaleLowerCase()))
            .slice(0, 8),
    [commands, slashQuery],
  );
  const aboveWidgets = Object.entries(widgets).filter(([, widget]) => widget.placement === "aboveEditor");
  const belowWidgets = Object.entries(widgets).filter(([, widget]) => widget.placement === "belowEditor");

  useEffect(() => {
    if (!editorInjection) return;
    onDraftChange(editorInjection.text);
    textareaRef.current?.focus();
  }, [editorInjection?.id]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
  }, [draft]);

  const submit = async () => {
    if (sending || (!draft.trim() && images.length === 0)) return;
    setSending(true);
    try {
      await onSend(draft.trim(), images);
      onDraftChange("");
      setImages(Object.freeze([]));
    } catch (error) {
      onError(`消息发送失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  };

  return (
    <div className="composer-wrap">
      <div className="composer-orbit" aria-hidden="true"><i /><span /><span /></div>
      <div className={`composer ${streaming ? "is-streaming" : ""}`}>
        {matchingCommands.length > 0 && (
          <div className="slash-menu popover-surface">
            <p className="popover-label">Pi 命令</p>
            {matchingCommands.map((command) => (
              <button
                type="button"
                key={`${command.source}:${command.name}`}
                onClick={() => {
                  onDraftChange(`/${command.name} `);
                  textareaRef.current?.focus();
                }}
              >
                <span className={`slash-menu__source slash-menu__source--${command.source}`}><Command size={13} /></span>
                <span><strong>/{command.name}</strong><small>{command.description || command.source}</small></span>
              </button>
            ))}
          </div>
        )}

        {images.length > 0 && (
          <div className="composer-images">
            {images.map((image, index) => (
              <div key={`${image.name}-${index}`}>
                <img src={`data:${image.mimeType};base64,${image.data}`} alt={image.name} />
                <button type="button" aria-label={`移除 ${image.name}`} onClick={() => setImages(Object.freeze(images.filter((_, imageIndex) => imageIndex !== index)))}><X size={12} /></button>
                <span>{image.name}</span>
              </div>
            ))}
          </div>
        )}

        {aboveWidgets.map(([key, widget]) => <div className="composer-widget" key={key}><strong>{key}</strong><pre>{widget.lines.join("\n")}</pre></div>)}

        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape" && streaming) onStop();
          }}
          placeholder={streaming ? "补充指令，或排到当前任务之后…" : "描述目标，@ 文件，或输入 / 使用命令…"}
          rows={1}
          aria-label="给 Pi 的消息"
        />

        {belowWidgets.map(([key, widget]) => <div className="composer-widget composer-widget--below" key={key}><strong>{key}</strong><pre>{widget.lines.join("\n")}</pre></div>)}

        <div className="composer__toolbar">
          <div className="composer__tools">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                void Promise.all(files.map(fileToImage))
                  .then((next) => setImages(Object.freeze([...images, ...next])))
                  .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
                event.currentTarget.value = "";
              }}
            />
            <button type="button" className="composer-tool" aria-label="添加图片" title="添加图片" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /></button>
            <button type="button" className="composer-tool" aria-label="运行命令" title="运行命令" onClick={onOpenTerminal}><TerminalSquare size={17} /></button>
            <button type="button" className="composer-tool composer-tool--commands" onClick={onOpenPalette}><Command size={15} /><span>命令</span></button>
            {streaming && (
              <div className="queue-mode" role="group" aria-label="消息发送方式">
                <button type="button" className={queueMode === "steer" ? "is-active" : ""} onClick={() => onQueueModeChange("steer")}>引导</button>
                <button type="button" className={queueMode === "followUp" ? "is-active" : ""} onClick={() => onQueueModeChange("followUp")}>排队</button>
              </div>
            )}
          </div>
          <div className="composer__send-area">
            <span className="composer__signature" aria-label="Stella 签名">Stella</span>
            <span className="composer__hint">Enter 发送 · Shift Enter 换行</span>
            {streaming ? (
              <button type="button" className="send-button send-button--stop" aria-label="停止" onClick={onStop}><Square size={15} fill="currentColor" /></button>
            ) : (
              <button type="button" className="send-button" disabled={sending || (!draft.trim() && images.length === 0)} aria-label="发送" onClick={() => void submit()}><ArrowUp size={18} /></button>
            )}
          </div>
        </div>
        <div className="composer__attachment-note"><FileImage size={11} /> 图片会以内联数据发送给当前模型</div>
      </div>
    </div>
  );
}

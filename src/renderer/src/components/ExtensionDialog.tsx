import { useEffect, useState } from "react";
import { Blocks, Check } from "lucide-react";
import type { PiExtensionResponse } from "@shared/contracts";
import type { ExtensionRequest } from "../lib/runtime-state";
import { Modal } from "./Modal";

interface ExtensionDialogProps {
  readonly request: ExtensionRequest;
  readonly onRespond: (response: PiExtensionResponse) => void;
  readonly onExpire: (id: string) => void;
}

export function ExtensionDialog({ request, onRespond, onExpire }: ExtensionDialogProps) {
  const [value, setValue] = useState(request.prefill ?? "");
  const cancel = () => onRespond({ type: "extension_ui_response", id: request.id, cancelled: true });

  useEffect(() => {
    if (!request.timeout) return;
    const timeoutId = window.setTimeout(() => onExpire(request.id), request.timeout);
    return () => window.clearTimeout(timeoutId);
  }, [onExpire, request.id, request.timeout]);

  const timeoutNote = request.timeout ? (
    <p className="extension-timeout">此请求将在 {Math.max(1, Math.ceil(request.timeout / 1000))} 秒后自动关闭。</p>
  ) : null;

  if (request.method === "select") {
    return (
      <Modal title={request.title} eyebrow="PI EXTENSION" onClose={cancel} className="extension-dialog">
        <div className="extension-dialog__mark"><Blocks size={17} /><span>扩展需要你选择一项后才能继续。</span></div>
        {timeoutNote}
        <div className="extension-options">
          {(request.options ?? []).map((option) => (
            <button type="button" key={option} onClick={() => onRespond({ type: "extension_ui_response", id: request.id, value: option })}>
              <span>{option}</span><Check size={14} />
            </button>
          ))}
        </div>
        <div className="modal-actions"><button type="button" className="button-secondary" onClick={cancel}>取消</button></div>
      </Modal>
    );
  }

  if (request.method === "confirm") {
    return (
      <Modal title={request.title} eyebrow="PI EXTENSION" onClose={cancel} className="extension-dialog">
        <p className="extension-confirm-message">{request.message}</p>
        {timeoutNote}
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={() => onRespond({ type: "extension_ui_response", id: request.id, confirmed: false })}>否</button>
          <button type="button" className="button-primary" onClick={() => onRespond({ type: "extension_ui_response", id: request.id, confirmed: true })}>确认</button>
        </div>
      </Modal>
    );
  }

  const isEditor = request.method === "editor";
  return (
    <Modal title={request.title} eyebrow="PI EXTENSION" onClose={cancel} className="extension-dialog">
      {isEditor ? (
        <textarea className="modal-editor" value={value} onChange={(event) => setValue(event.target.value)} rows={12} />
      ) : (
        <input className="modal-input" value={value} onChange={(event) => setValue(event.target.value)} placeholder={request.placeholder} />
      )}
      {timeoutNote}
      <div className="modal-actions">
        <button type="button" className="button-secondary" onClick={cancel}>取消</button>
        <button type="button" className="button-primary" onClick={() => onRespond({ type: "extension_ui_response", id: request.id, value })}>提交</button>
      </div>
    </Modal>
  );
}

import { useState } from "react";
import { Modal } from "./Modal";

interface TextPromptDialogProps {
  readonly title: string;
  readonly eyebrow: string;
  readonly label: string;
  readonly initialValue: string;
  readonly confirmLabel: string;
  readonly onConfirm: (value: string) => void;
  readonly onCancel: () => void;
}

export function TextPromptDialog({ title, eyebrow, label, initialValue, confirmLabel, onConfirm, onCancel }: TextPromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <Modal title={title} eyebrow={eyebrow} onClose={onCancel} className="text-prompt-dialog">
      <label className="field-label"><span>{label}</span><input className="modal-input" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Enter" && value.trim()) onConfirm(value.trim());
      }} /></label>
      <div className="modal-actions"><button type="button" className="button-secondary" onClick={onCancel}>取消</button><button type="button" className="button-primary" disabled={!value.trim()} onClick={() => onConfirm(value.trim())}>{confirmLabel}</button></div>
    </Modal>
  );
}

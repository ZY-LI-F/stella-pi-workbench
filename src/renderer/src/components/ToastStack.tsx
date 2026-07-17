import { useEffect } from "react";
import { Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import type { Notice } from "../lib/runtime-state";

function Toast({ notice, onDismiss }: { readonly notice: Notice; readonly onDismiss: (id: string) => void }) {
  useEffect(() => {
    if (notice.type === "error") return;
    const timeout = window.setTimeout(() => onDismiss(notice.id), 4500);
    return () => window.clearTimeout(timeout);
  }, [notice.id, notice.type, onDismiss]);
  const Icon = notice.type === "success" ? Check : notice.type === "error" ? CircleAlert : notice.type === "warning" ? TriangleAlert : Info;
  return <div className={`toast toast--${notice.type}`} role={notice.type === "error" ? "alert" : "status"}><span><Icon size={15} /></span><p>{notice.message}</p><button type="button" aria-label="关闭通知" onClick={() => onDismiss(notice.id)}><X size={13} /></button></div>;
}

export function ToastStack({ notices, onDismiss }: { readonly notices: readonly Notice[]; readonly onDismiss: (id: string) => void }) {
  return <div className="toast-stack">{notices.map((notice) => <Toast key={notice.id} notice={notice} onDismiss={onDismiss} />)}</div>;
}

import { Minus, Square, X } from "lucide-react";
import type { StellaDesktopApi } from "@shared/contracts";

interface WindowControlsProps {
  readonly api: StellaDesktopApi;
}
export function WindowControls({ api }: WindowControlsProps) {
  return (
    <div className="window-controls" aria-label="窗口控制">
      <button type="button" aria-label="最小化" onClick={() => void api.windowAction("minimize")}>
        <Minus size={14} />
      </button>
      <button type="button" aria-label="最大化或还原" onClick={() => void api.windowAction("maximize")}>
        <Square size={11} />
      </button>
      <button
        type="button"
        className="window-controls__close"
        aria-label="关闭"
        onClick={() => void api.windowAction("close")}
      >
        <X size={14} />
      </button>
    </div>
  );
}

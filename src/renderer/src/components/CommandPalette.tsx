import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Archive,
  Command,
  FileOutput,
  FolderOpen,
  GitFork,
  MoonStar,
  Plus,
  Search,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import type { SlashCommandSummary } from "@shared/contracts";

export interface PaletteAction {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly icon: ComponentType<{ size?: number }>;
  readonly run: () => void;
}

interface CommandPaletteProps {
  readonly commands: readonly SlashCommandSummary[];
  readonly actions: readonly PaletteAction[];
  readonly onInsertCommand: (command: SlashCommandSummary) => void;
  readonly onClose: () => void;
}

const DEFAULT_ACTION_ICONS = Object.freeze({
  new: Plus,
  folder: FolderOpen,
  terminal: TerminalSquare,
  fork: GitFork,
  compact: Archive,
  export: FileOutput,
  settings: Settings2,
  model: MoonStar,
});

export function CommandPalette({ commands, actions, onInsertCommand, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalized = query.trim().replace(/^\//, "").toLocaleLowerCase();
  const filteredActions = useMemo(
    () => actions.filter((action) => `${action.label} ${action.detail}`.toLocaleLowerCase().includes(normalized)),
    [actions, normalized],
  );
  const filteredCommands = useMemo(
    () => commands.filter((command) => `${command.name} ${command.description ?? ""}`.toLocaleLowerCase().includes(normalized)).slice(0, 12),
    [commands, normalized],
  );
  const itemCount = filteredActions.length + filteredCommands.length;

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActiveIndex(0), [query]);

  const runAt = (index: number) => {
    const action = filteredActions[index];
    if (action) {
      onClose();
      action.run();
      return;
    }
    const command = filteredCommands[index - filteredActions.length];
    if (command) {
      onClose();
      onInsertCommand(command);
    }
  };

  return (
    <div className="palette-layer" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="搜索与命令">
        <div className="command-palette__input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索操作、技能或提示词…"
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((value) => (itemCount === 0 ? 0 : (value + 1) % itemCount));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((value) => (itemCount === 0 ? 0 : (value - 1 + itemCount) % itemCount));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                runAt(activeIndex);
              }
            }}
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-palette__results">
          {filteredActions.length > 0 && <p className="popover-label">工作台操作</p>}
          {filteredActions.map((action, index) => {
            const Icon = action.icon;
            return (
              <button type="button" className={activeIndex === index ? "is-active" : ""} key={action.id} onMouseEnter={() => setActiveIndex(index)} onClick={() => runAt(index)}>
                <span className="palette-icon"><Icon size={16} /></span><span><strong>{action.label}</strong><small>{action.detail}</small></span>
              </button>
            );
          })}
          {filteredCommands.length > 0 && <p className="popover-label">Pi 命令</p>}
          {filteredCommands.map((command, index) => {
            const absoluteIndex = filteredActions.length + index;
            return (
              <button type="button" className={activeIndex === absoluteIndex ? "is-active" : ""} key={`${command.source}:${command.name}`} onMouseEnter={() => setActiveIndex(absoluteIndex)} onClick={() => runAt(absoluteIndex)}>
                <span className={`palette-icon palette-icon--${command.source}`}><Command size={15} /></span>
                <span><strong>/{command.name}</strong><small>{command.description || command.source}</small></span>
                <em>{command.source}</em>
              </button>
            );
          })}
          {itemCount === 0 && <div className="palette-empty"><Search size={20} /><p>没有匹配的操作或命令。</p></div>}
        </div>
        <div className="command-palette__footer"><span>↑↓ 选择</span><span>↵ 执行</span><span><Command size={12} /> Pi v commands</span></div>
      </div>
    </div>
  );
}

export { DEFAULT_ACTION_ICONS };

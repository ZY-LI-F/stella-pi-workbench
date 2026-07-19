import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AtSign, Bot, GitBranch, ShieldCheck } from "lucide-react";
import {
  agentMentionQueryAtCaret,
  filterMentionAgents,
  insertAgentMention,
  mentionedAgentIds,
  type AgentMentionQuery,
} from "@shared/agent-mentions";
import type { AgentPresence } from "@shared/agent-presence";
import type { AgentDefinition } from "@shared/kanban";
import { AGENT_PRESENCE_LABEL } from "./kanban-format";

export interface AgentMentionRequest {
  readonly requestId: number;
  readonly agentId: string;
}

interface AgentMentionInputProps {
  readonly id: string;
  readonly value: string;
  readonly agents: readonly AgentDefinition[];
  readonly presences?: readonly AgentPresence[];
  readonly placeholder: string;
  readonly rows?: number;
  readonly mentionsDisabled?: boolean;
  readonly mentionsDisabledReason?: string;
  readonly mentionRequest?: AgentMentionRequest;
  readonly onChange: (value: string) => void;
  readonly onQueryChange?: (query?: AgentMentionQuery) => void;
  readonly onRequestError?: (message: string) => void;
}

function optionRestriction(agent: AgentDefinition, selectedIds: ReadonlySet<string>): string | undefined {
  if (selectedIds.has(agent.id)) return "已选择";
  const hasLead = selectedIds.has("lead");
  if (hasLead && agent.id !== "lead") return "已进入 LEAD 协调模式";
  if (agent.id === "lead" && selectedIds.size > 0) return "先移除直接 Worker mention";
  return undefined;
}

export function AgentMentionInput({
  id,
  value,
  agents,
  presences = [],
  placeholder,
  rows = 3,
  mentionsDisabled = false,
  mentionsDisabledReason,
  mentionRequest,
  onChange,
  onQueryChange,
  onRequestError,
}: AgentMentionInputProps) {
  const listId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const caretRef = useRef(value.length);
  const handledRequestRef = useRef<number | undefined>(undefined);
  const [caret, setCaret] = useState(value.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedQuery, setDismissedQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const presenceByAgent = useMemo(() => new Map(presences.map((presence) => [presence.agent.id, presence])), [presences]);
  const normalizedCaret = Math.min(caret, value.length);
  const activeQuery = useMemo(() => agentMentionQueryAtCaret(value, normalizedCaret), [normalizedCaret, value]);
  const queryKey = activeQuery ? `${activeQuery.start}:${activeQuery.end}:${activeQuery.query}` : "";
  const pickerOpen = Boolean(activeQuery) && !mentionsDisabled && !composing && dismissedQuery !== queryKey;
  const candidates = useMemo(
    () => pickerOpen && activeQuery ? filterMentionAgents(agents, activeQuery.query) : Object.freeze([] as AgentDefinition[]),
    [activeQuery, agents, pickerOpen],
  );
  const textWithoutActiveQuery = activeQuery && pickerOpen
    ? `${value.slice(0, activeQuery.start)}${value.slice(activeQuery.end)}`
    : value;
  const selectedIds = useMemo(() => mentionedAgentIds(textWithoutActiveQuery, agents), [agents, textWithoutActiveQuery]);
  const selectableIndices = useMemo(
    () => candidates.flatMap((agent, index) => optionRestriction(agent, selectedIds) ? [] : [index]),
    [candidates, selectedIds],
  );

  useEffect(() => {
    const first = selectableIndices[0] ?? 0;
    setActiveIndex(first);
  }, [queryKey, selectableIndices.length]);

  useEffect(() => {
    onQueryChange?.(pickerOpen ? activeQuery : undefined);
  }, [activeQuery?.end, activeQuery?.query, activeQuery?.start, onQueryChange, pickerOpen]);

  useEffect(() => {
    if (caretRef.current <= value.length) return;
    caretRef.current = value.length;
    setCaret(value.length);
  }, [value.length]);

  const focusAt = (position: number): void => {
    caretRef.current = position;
    setCaret(position);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(position, position);
    });
  };

  const insert = (agent: AgentDefinition): void => {
    const restriction = optionRestriction(agent, selectedIds);
    if (restriction) return;
    const range = activeQuery ?? Object.freeze({ start: caretRef.current, end: caretRef.current });
    const next = insertAgentMention(value, range, agent);
    setDismissedQuery("");
    onChange(next.value);
    focusAt(next.caret);
  };

  useEffect(() => {
    if (!mentionRequest || handledRequestRef.current === mentionRequest.requestId) return;
    handledRequestRef.current = mentionRequest.requestId;
    const agent = agents.find((candidate) => candidate.id === mentionRequest.agentId);
    if (!agent) {
      onRequestError?.(`Agent ${mentionRequest.agentId} 不在当前 Task Room 的可 @ 范围内`);
      return;
    }
    if (mentionsDisabled) {
      onRequestError?.(mentionsDisabledReason ?? "当前任务不能创建新的 Agent mention");
      return;
    }
    const restriction = optionRestriction(agent, selectedIds);
    if (restriction) {
      onRequestError?.(`${agent.name}：${restriction}`);
      return;
    }
    const range = activeQuery ?? Object.freeze({ start: caretRef.current, end: caretRef.current });
    const next = insertAgentMention(value, range, agent);
    setDismissedQuery("");
    onChange(next.value);
    focusAt(next.caret);
  }, [mentionRequest?.requestId]);

  const moveActive = (direction: 1 | -1): void => {
    if (selectableIndices.length === 0) return;
    const current = selectableIndices.indexOf(activeIndex);
    const next = current < 0
      ? selectableIndices[0]
      : selectableIndices[(current + direction + selectableIndices.length) % selectableIndices.length];
    if (next !== undefined) setActiveIndex(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!pickerOpen || composing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const agent = candidates[activeIndex];
      if (!agent || optionRestriction(agent, selectedIds)) return;
      event.preventDefault();
      insert(agent);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDismissedQuery(queryKey);
    }
  };

  const updateCaret = (): void => {
    const position = textareaRef.current?.selectionStart ?? value.length;
    caretRef.current = position;
    setCaret(position);
  };

  return (
    <div className="agent-mention-field">
      <div className="agent-mention-roster" aria-label="可 @ 的 Agent">
        <span><AtSign size={11} />可 @</span>
        <div>
          {agents.map((agent) => {
            const restriction = optionRestriction(agent, selectedIds);
            const disabled = mentionsDisabled || Boolean(restriction);
            const title = mentionsDisabled ? mentionsDisabledReason : restriction;
            return <button type="button" key={agent.id} className={`${agent.id === "lead" ? "is-lead" : ""} ${selectedIds.has(agent.id) ? "is-selected" : ""}`} disabled={disabled} title={title} aria-label={`@ ${agent.name}`} onClick={() => insert(agent)}><span>@{agent.callsign}</span></button>;
          })}
        </div>
      </div>

      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        rows={rows}
        placeholder={placeholder}
        aria-autocomplete="list"
        aria-controls={pickerOpen ? listId : undefined}
        aria-expanded={pickerOpen}
        aria-activedescendant={pickerOpen && candidates[activeIndex] ? `${listId}-${candidates[activeIndex]?.id}` : undefined}
        onChange={(event) => {
          const position = event.currentTarget.selectionStart;
          caretRef.current = position;
          setCaret(position);
          setDismissedQuery("");
          onChange(event.currentTarget.value);
        }}
        onClick={updateCaret}
        onKeyUp={(event) => {
          if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) updateCaret();
        }}
        onKeyDown={onKeyDown}
        onSelect={updateCaret}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => { setComposing(false); updateCaret(); }}
      />

      {pickerOpen && (
        <div className="agent-mention-picker" id={listId} role="listbox" aria-label="选择要 @ 的 Agent">
          <header><span><GitBranch size={12} />AGENT ROSTER</span><small>{candidates.length} 位可匹配</small></header>
          <div className="agent-mention-picker__list">
            {candidates.map((agent, index) => {
              const presence = presenceByAgent.get(agent.id);
              const restriction = optionRestriction(agent, selectedIds);
              return (
                <button
                  type="button"
                  role="option"
                  id={`${listId}-${agent.id}`}
                  key={agent.id}
                  aria-selected={index === activeIndex}
                  className={`${index === activeIndex ? "is-active" : ""} ${restriction ? "is-restricted" : ""}`}
                  disabled={Boolean(restriction)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => { if (!restriction) setActiveIndex(index); }}
                  onClick={() => insert(agent)}
                >
                  <span className="agent-mention-picker__avatar"><Bot size={14} /><i /></span>
                  <span className="agent-mention-picker__identity"><strong>{agent.name}</strong><small>{agent.responsibility}</small></span>
                  <span className="agent-mention-picker__meta"><code>@{agent.callsign}</code><b className={`is-${presence?.state ?? "available"}`}>{restriction ?? AGENT_PRESENCE_LABEL[presence?.state ?? "available"]}</b><small><ShieldCheck size={9} />{agent.workspaceAccess === "write" ? "可写" : "只读"}{agent.requiredSkills?.length ? ` · ${agent.requiredSkills.join(" / ")}` : ""}</small></span>
                </button>
              );
            })}
            {candidates.length === 0 && <div className="agent-mention-picker__empty"><AtSign size={17} /><strong>没有匹配的 Agent</strong><span>可按中文名称、呼号、ID 或职责搜索。</span></div>}
          </div>
          <footer><span>↑↓ 选择</span><span>Enter / Tab 插入</span><span>Esc 关闭</span></footer>
        </div>
      )}
    </div>
  );
}

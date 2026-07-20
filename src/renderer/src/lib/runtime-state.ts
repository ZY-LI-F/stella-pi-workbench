import type {
  BridgeEvent,
  PiExtensionResponse,
  RuntimeBootstrap,
  SerializableMessage,
} from "@shared/contracts";

export interface ToolExecutionState {
  readonly id: string;
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly status: "running" | "complete" | "error";
  readonly partialResult?: unknown;
  readonly result?: unknown;
  readonly startedAt: number;
}

export interface Notice {
  readonly id: string;
  readonly type: "info" | "warning" | "error" | "success";
  readonly message: string;
}

export interface ExtensionRequest {
  readonly type: "extension_ui_request";
  readonly id: string;
  readonly method: "select" | "confirm" | "input" | "editor";
  readonly title: string;
  readonly options?: readonly string[];
  readonly message?: string;
  readonly placeholder?: string;
  readonly prefill?: string;
  readonly timeout?: number;
}

export interface RuntimeUiState {
  readonly phase: "loading" | "ready" | "error";
  readonly bootstrap?: RuntimeBootstrap;
  readonly messages: readonly SerializableMessage[];
  readonly streaming: boolean;
  readonly compacting: boolean;
  readonly retrying: boolean;
  readonly queue: {
    readonly steering: readonly string[];
    readonly followUp: readonly string[];
  };
  readonly tools: Readonly<Record<string, ToolExecutionState>>;
  readonly extensionRequest?: ExtensionRequest;
  readonly extensionStatuses: Readonly<Record<string, string>>;
  readonly extensionWidgets: Readonly<
    Record<string, { readonly lines: readonly string[]; readonly placement: "aboveEditor" | "belowEditor" }>
  >;
  readonly editorInjection?: { readonly id: string; readonly text: string };
  readonly windowTitle?: string;
  readonly notices: readonly Notice[];
  readonly stderr: string;
  readonly error?: string;
}

export type RuntimeAction =
  | { readonly type: "BOOTSTRAP"; readonly payload: RuntimeBootstrap }
  | { readonly type: "INITIALIZE_FAILED"; readonly error: string }
  | { readonly type: "SYNC_FAILED"; readonly error: string }
  | { readonly type: "BRIDGE_EVENT"; readonly event: BridgeEvent }
  | { readonly type: "EXTENSION_RESOLVED"; readonly response: PiExtensionResponse }
  | { readonly type: "EXTENSION_EXPIRED"; readonly id: string }
  | { readonly type: "NOTICE"; readonly notice: Notice }
  | { readonly type: "DISMISS_NOTICE"; readonly id: string };

export const INITIAL_RUNTIME_STATE: RuntimeUiState = Object.freeze({
  phase: "loading",
  messages: Object.freeze([]),
  streaming: false,
  compacting: false,
  retrying: false,
  queue: Object.freeze({ steering: Object.freeze([]), followUp: Object.freeze([]) }),
  tools: Object.freeze({}),
  extensionStatuses: Object.freeze({}),
  extensionWidgets: Object.freeze({}),
  notices: Object.freeze([]),
  stderr: "",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : Object.freeze({});
}

function messageIdentity(message: SerializableMessage): string {
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : 0;
  if (message.role === "toolResult") return `${message.role}:${message.toolCallId}:${timestamp}`;
  return `${message.role}:${timestamp}`;
}

function upsertMessage(
  messages: readonly SerializableMessage[],
  incoming: SerializableMessage,
): readonly SerializableMessage[] {
  const identity = messageIdentity(incoming);
  const index = messages.findIndex((message) => messageIdentity(message) === identity);
  if (index < 0) return Object.freeze([...messages, incoming]);
  return Object.freeze(messages.map((message, messageIndex) => (messageIndex === index ? incoming : message)));
}

function noticeFromExtension(payload: Record<string, unknown>): Notice {
  const rawType = payload.notifyType;
  const type = rawType === "warning" || rawType === "error" ? rawType : "info";
  return Object.freeze({
    id: typeof payload.id === "string" ? payload.id : crypto.randomUUID(),
    type,
    message: typeof payload.message === "string" ? payload.message : "扩展发来了一条空通知",
  });
}

function extensionDialog(payload: Record<string, unknown>): ExtensionRequest {
  const method = payload.method;
  if (method !== "select" && method !== "confirm" && method !== "input" && method !== "editor") {
    throw new Error(`不支持的扩展对话框方法: ${String(method)}`);
  }
  return Object.freeze({
    type: "extension_ui_request",
    id: String(payload.id),
    method,
    title: typeof payload.title === "string" ? payload.title : "Pi 扩展请求",
    options: Array.isArray(payload.options)
      ? Object.freeze(payload.options.filter((option): option is string => typeof option === "string"))
      : undefined,
    message: typeof payload.message === "string" ? payload.message : undefined,
    placeholder: typeof payload.placeholder === "string" ? payload.placeholder : undefined,
    prefill: typeof payload.prefill === "string" ? payload.prefill : undefined,
    timeout:
      typeof payload.timeout === "number" && Number.isFinite(payload.timeout) && payload.timeout > 0
        ? payload.timeout
        : undefined,
  });
}

function handleExtensionRequest(state: RuntimeUiState, payload: Record<string, unknown>): RuntimeUiState {
  const method = payload.method;
  if (method === "notify") {
    return { ...state, notices: Object.freeze([...state.notices, noticeFromExtension(payload)]) };
  }
  if (method === "setStatus") {
    const key = String(payload.statusKey);
    const statuses = { ...state.extensionStatuses };
    if (typeof payload.statusText === "string") statuses[key] = payload.statusText;
    else delete statuses[key];
    return { ...state, extensionStatuses: Object.freeze(statuses) };
  }
  if (method === "setWidget") {
    const key = String(payload.widgetKey);
    const widgets = { ...state.extensionWidgets };
    if (Array.isArray(payload.widgetLines)) {
      widgets[key] = Object.freeze({
        lines: Object.freeze(payload.widgetLines.filter((line): line is string => typeof line === "string")),
        placement: payload.widgetPlacement === "aboveEditor" ? "aboveEditor" : "belowEditor",
      });
    } else {
      delete widgets[key];
    }
    return { ...state, extensionWidgets: Object.freeze(widgets) };
  }
  if (method === "setTitle" && typeof payload.title === "string") {
    return { ...state, windowTitle: payload.title };
  }
  if (method === "set_editor_text" && typeof payload.text === "string") {
    return {
      ...state,
      editorInjection: Object.freeze({ id: String(payload.id), text: payload.text }),
    };
  }
  return { ...state, extensionRequest: extensionDialog(payload) };
}

function handlePiEvent(state: RuntimeUiState, payload: Record<string, unknown>): RuntimeUiState {
  if (payload.type === "extension_ui_request") return handleExtensionRequest(state, payload);
  if (payload.type === "agent_start") return { ...state, streaming: true, retrying: false };
  if (payload.type === "agent_settled") return { ...state, streaming: false, retrying: false };
  if (payload.type === "compaction_start") return { ...state, compacting: true };
  if (payload.type === "compaction_end") return { ...state, compacting: false };
  if (payload.type === "auto_retry_start") return { ...state, retrying: true };
  if (payload.type === "auto_retry_end") return { ...state, retrying: false };
  if (payload.type === "queue_update") {
    return {
      ...state,
      queue: Object.freeze({
        steering: Object.freeze(Array.isArray(payload.steering) ? payload.steering.map(String) : []),
        followUp: Object.freeze(Array.isArray(payload.followUp) ? payload.followUp.map(String) : []),
      }),
    };
  }
  if (
    (payload.type === "message_start" || payload.type === "message_update" || payload.type === "message_end") &&
    isRecord(payload.message)
  ) {
    return {
      ...state,
      messages: upsertMessage(state.messages, payload.message as SerializableMessage),
    };
  }
  if (payload.type === "tool_execution_start") {
    const id = String(payload.toolCallId);
    return {
      ...state,
      tools: Object.freeze({
        ...state.tools,
        [id]: Object.freeze({
          id,
          name: String(payload.toolName),
          args: recordValue(payload.args),
          status: "running",
          startedAt: Date.now(),
        }),
      }),
    };
  }
  if (payload.type === "tool_execution_update") {
    const id = String(payload.toolCallId);
    const previous = state.tools[id];
    if (!previous) return state;
    return {
      ...state,
      tools: Object.freeze({
        ...state.tools,
        [id]: Object.freeze({ ...previous, partialResult: payload.partialResult }),
      }),
    };
  }
  if (payload.type === "tool_execution_end") {
    const id = String(payload.toolCallId);
    const previous = state.tools[id];
    const completed: ToolExecutionState = Object.freeze({
      id,
      name: previous?.name ?? String(payload.toolName),
      args: previous?.args ?? Object.freeze({}),
      status: payload.isError ? "error" : "complete",
      result: payload.result,
      startedAt: previous?.startedAt ?? Date.now(),
    });
    return { ...state, tools: Object.freeze({ ...state.tools, [id]: completed }) };
  }
  if (payload.type === "session_info_changed" && state.bootstrap) {
    const sessionName = typeof payload.name === "string" ? payload.name : undefined;
    return {
      ...state,
      bootstrap: Object.freeze({
        ...state.bootstrap,
        state: Object.freeze({ ...state.bootstrap.state, sessionName }),
      }),
    };
  }
  if (payload.type === "thinking_level_changed" && state.bootstrap && typeof payload.level === "string") {
    return {
      ...state,
      bootstrap: Object.freeze({
        ...state.bootstrap,
        state: Object.freeze({
          ...state.bootstrap.state,
          thinkingLevel: payload.level as RuntimeBootstrap["state"]["thinkingLevel"],
        }),
      }),
    };
  }
  return state;
}

function handleBridgeEvent(state: RuntimeUiState, event: BridgeEvent): RuntimeUiState {
  if (event.source === "pi") return handlePiEvent(state, event.payload as unknown as Record<string, unknown>);
  if (event.source === "board") return state;
  const payload = event.payload;
  if (payload.type === "runtime_stderr") return { ...state, stderr: `${state.stderr}${payload.message}` };
  // 运行时重启成功后清除上一次 runtime_exit / protocol_error 留下的错误横幅。
  if (payload.type === "runtime_ready") return { ...state, error: undefined };
  if (payload.type === "runtime_exit") {
    return {
      ...state,
      streaming: false,
      error: `Pi RPC 已退出（code=${String(payload.code)}，signal=${String(payload.signal)}）`,
    };
  }
  if (payload.type === "protocol_error") {
    return { ...state, error: `Pi RPC 协议错误：${payload.message}` };
  }
  return state;
}

export function runtimeReducer(state: RuntimeUiState, action: RuntimeAction): RuntimeUiState {
  if (action.type === "BOOTSTRAP") {
    return {
      ...state,
      phase: "ready",
      bootstrap: action.payload,
      messages: action.payload.messages,
      streaming: action.payload.state.isStreaming,
      compacting: action.payload.state.isCompacting,
      error: undefined,
    };
  }
  if (action.type === "INITIALIZE_FAILED") return { ...state, phase: "error", error: action.error };
  if (action.type === "SYNC_FAILED") {
    return {
      ...state,
      error: action.error,
      notices: Object.freeze([
        ...state.notices,
        Object.freeze({ id: crypto.randomUUID(), type: "error", message: action.error }),
      ]),
    };
  }
  if (action.type === "BRIDGE_EVENT") return handleBridgeEvent(state, action.event);
  if (action.type === "EXTENSION_RESOLVED") {
    if (state.extensionRequest?.id !== action.response.id) return state;
    return { ...state, extensionRequest: undefined };
  }
  if (action.type === "EXTENSION_EXPIRED") {
    if (state.extensionRequest?.id !== action.id) return state;
    return { ...state, extensionRequest: undefined };
  }
  if (action.type === "NOTICE") return { ...state, notices: Object.freeze([...state.notices, action.notice]) };
  if (action.type === "DISMISS_NOTICE") {
    return { ...state, notices: Object.freeze(state.notices.filter((notice) => notice.id !== action.id)) };
  }
  return state;
}

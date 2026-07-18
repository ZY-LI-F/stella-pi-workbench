import type { RuntimeBootstrap, SerializableContentBlock, SerializableMessage } from "@shared/contracts";
import type { TaskPriority } from "@shared/kanban";
import { isBackgroundSessionName } from "@shared/session-policy";

export interface PiTaskDraft {
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
  readonly sourcePiSessionPath: string;
  readonly sourcePiSessionId: string;
}

function textBlocks(blocks: readonly SerializableContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<SerializableContentBlock, { readonly type: "text" }> => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n");
}

function messageText(message: SerializableMessage): string {
  if (message.role !== "user" && message.role !== "assistant") return "";
  return typeof message.content === "string" ? message.content.trim() : textBlocks(message.content);
}

function lastMessageText(messages: readonly SerializableMessage[], role: "user" | "assistant"): string {
  const message = [...messages].reverse().find((candidate) => candidate.role === role);
  return message ? messageText(message) : "";
}

function firstLine(value: string): string {
  return value.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
}

export function createPiTaskDraft(bootstrap: RuntimeBootstrap): PiTaskDraft {
  const sessionPath = bootstrap.state.sessionFile;
  if (typeof sessionPath !== "string" || sessionPath.trim().length === 0) {
    throw new Error("当前 Pi 会话尚未生成可持久化的 session 文件");
  }
  if (!bootstrap.state.sessionId) throw new Error("当前 Pi 会话缺少 session identity");
  const currentSession = bootstrap.sessions.find((session) => session.path === sessionPath);
  const latestUser = lastMessageText(bootstrap.messages, "user");
  const latestAssistant = lastMessageText(bootstrap.messages, "assistant");
  const sessionName = currentSession?.name && !isBackgroundSessionName(currentSession.name) ? currentSession.name.trim() : "";
  const title = firstLine(sessionName || latestUser || currentSession?.firstMessage || "来自 Pi 会话的任务");
  const context = [
    latestUser ? `## 当前请求\n${latestUser}` : "",
    latestAssistant ? `## 最近答复\n${latestAssistant}` : "",
  ].filter(Boolean).join("\n\n");
  return Object.freeze({
    title,
    description: context,
    acceptanceCriteria: "",
    priority: "medium",
    sourcePiSessionPath: sessionPath,
    sourcePiSessionId: bootstrap.state.sessionId,
  });
}

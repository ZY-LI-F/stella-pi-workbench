import type { SessionSummary } from "./contracts";

export const STELLA_BACKGROUND_SESSION_MARKER = "[[STELLA_BACKGROUND_V1]]" as const;
const LEGACY_BACKGROUND_SESSION_PREFIX = "[Stella] ";

export interface BackgroundSessionNameInput {
  readonly taskId: string;
  readonly executionKind: "workflow-step" | "agent-task";
  readonly executionId: string;
  readonly label: string;
}

export function backgroundSessionName(input: BackgroundSessionNameInput): string {
  return `${STELLA_BACKGROUND_SESSION_MARKER} task:${input.taskId} ${input.executionKind}:${input.executionId} · ${input.label}`;
}

export function isBackgroundSessionName(name: string | undefined): boolean {
  return name?.startsWith(STELLA_BACKGROUND_SESSION_MARKER) === true
    || name?.startsWith(LEGACY_BACKGROUND_SESSION_PREFIX) === true;
}

export function visibleInteractiveSessions(sessions: readonly SessionSummary[]): readonly SessionSummary[] {
  return Object.freeze(sessions.filter((session) => !isBackgroundSessionName(session.name)));
}

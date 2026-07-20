import type {
  AgentSessionEvent,
  RpcCommand,
  RpcExtensionUIRequest,
  RpcExtensionUIResponse,
  RpcResponse,
  RpcSessionState,
  SessionStats,
} from "@earendil-works/pi-coding-agent";
import type {
  BoardBootstrap,
  BoardBridgeEvent,
  CreateAutopilotInput,
  CreateProjectAgentInput,
  CreateTaskCommentInput,
  CreateSquadInput,
  CreateTaskInput,
  LaunchTeamTaskInput,
  ManualTaskStage,
  OpenTaskSessionInput,
  ReviewExecutionInput,
  ResolveGateInput,
  UpdateTaskInput,
  UpdateAutopilotInput,
  UpdateProjectAgentInput,
  UpdateSquadInput,
} from "./kanban";
import type { CapabilityHealthSnapshot, CapabilityName } from "./capabilities";
import type { SkinArtworkDescriptor, SkinId } from "./skin-artwork";

type WithoutRequestId<T> = T extends { id?: string } ? Omit<T, "id"> : never;

export type PiCommand = WithoutRequestId<RpcCommand>;
export type PiResponse = RpcResponse;
export type PiExtensionResponse = RpcExtensionUIResponse;

export interface ModelSummary {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly reasoning: boolean;
}

export interface SlashCommandSummary {
  readonly name: string;
  readonly description?: string;
  readonly source: "extension" | "prompt" | "skill";
  readonly location?: string;
  readonly path?: string;
}

export interface SessionSummary {
  readonly path: string;
  readonly id: string;
  readonly cwd: string;
  readonly name?: string;
  readonly parentSessionPath?: string;
  readonly created: string;
  readonly modified: string;
  readonly messageCount: number;
  readonly firstMessage: string;
}

export interface RecentProject {
  readonly path: string;
  readonly trusted: boolean;
  readonly lastOpened: string;
}

export interface ProjectMeta {
  readonly cwd: string;
  readonly name: string;
  readonly branch?: string;
  readonly trusted: boolean;
  readonly requiresTrust: boolean;
}

export interface ProjectSelection {
  readonly path: string;
  readonly name: string;
  readonly requiresTrust: boolean;
}

export interface SessionEntrySummary {
  readonly id: string;
  readonly parentId: string | null;
  readonly type: string;
  readonly timestamp: string;
  readonly message?: SerializableMessage;
}

export interface SessionTreeSummary {
  readonly entry: SessionEntrySummary;
  readonly children: readonly SessionTreeSummary[];
  readonly label?: string;
}

export type SerializableContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "thinking"; readonly thinking: string; readonly redacted?: boolean }
  | {
      readonly type: "toolCall";
      readonly id: string;
      readonly name: string;
      readonly arguments: Readonly<Record<string, unknown>>;
    }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

export type SerializableMessage =
  | {
      readonly role: "user";
      readonly content: string | readonly SerializableContentBlock[];
      readonly timestamp: number;
    }
  | {
      readonly role: "assistant";
      readonly content: readonly SerializableContentBlock[];
      readonly provider: string;
      readonly model: string;
      readonly stopReason: string;
      readonly errorMessage?: string;
      readonly timestamp: number;
      readonly usage?: {
        readonly input: number;
        readonly output: number;
        readonly cacheRead: number;
        readonly cacheWrite: number;
        readonly totalTokens: number;
        readonly cost?: { readonly total: number };
      };
    }
  | {
      readonly role: "toolResult";
      readonly toolCallId: string;
      readonly toolName: string;
      readonly content: readonly SerializableContentBlock[];
      readonly isError: boolean;
      readonly timestamp: number;
    }
  | {
      readonly role: "bashExecution";
      readonly command: string;
      readonly output: string;
      readonly exitCode?: number;
      readonly cancelled: boolean;
      readonly truncated: boolean;
      readonly fullOutputPath?: string;
      readonly timestamp: number;
    }
  | {
      readonly role: "custom";
      readonly customType: string;
      readonly content: string | readonly SerializableContentBlock[];
      readonly display: boolean;
      readonly details?: unknown;
      readonly timestamp: number;
    }
  | {
      readonly role: "branchSummary";
      readonly summary: string;
      readonly fromId: string;
      readonly timestamp: number;
    }
  | {
      readonly role: "compactionSummary";
      readonly summary: string;
      readonly tokensBefore: number;
      readonly timestamp: number;
    };

export interface RuntimeBootstrap {
  readonly project: ProjectMeta;
  readonly recentProjects: readonly RecentProject[];
  readonly state: RpcSessionState;
  readonly messages: readonly SerializableMessage[];
  readonly models: readonly ModelSummary[];
  readonly commands: readonly SlashCommandSummary[];
  readonly sessions: readonly SessionSummary[];
  readonly stats: SessionStats;
  readonly entries: readonly SessionEntrySummary[];
  readonly tree: readonly SessionTreeSummary[];
  readonly leafId: string | null;
  readonly piVersion: string;
}

export type RuntimeSignal =
  | { readonly type: "runtime_starting"; readonly cwd: string }
  | { readonly type: "runtime_ready"; readonly cwd: string }
  | { readonly type: "runtime_stderr"; readonly message: string }
  | { readonly type: "runtime_exit"; readonly code: number | null; readonly signal: string | null }
  | { readonly type: "protocol_error"; readonly message: string; readonly record: string };

export type BridgeEvent =
  | { readonly source: "pi"; readonly payload: AgentSessionEvent | RpcExtensionUIRequest }
  | { readonly source: "runtime"; readonly payload: RuntimeSignal }
  | { readonly source: "board"; readonly payload: BoardBridgeEvent }
  | { readonly source: "capability"; readonly payload: { readonly type: "capability-health"; readonly snapshot: CapabilityHealthSnapshot } };

export interface StellaDesktopApi {
  capabilities(): Promise<CapabilityHealthSnapshot>;
  retryCapability(name: CapabilityName): Promise<CapabilityHealthSnapshot>;
  initialize(): Promise<RuntimeBootstrap>;
  command(command: PiCommand): Promise<PiResponse>;
  refresh(): Promise<RuntimeBootstrap>;
  respondToExtension(response: PiExtensionResponse): Promise<void>;
  chooseProject(): Promise<ProjectSelection | null>;
  skinArtworkInitialize(): Promise<readonly SkinArtworkDescriptor[]>;
  chooseSkinArtwork(skin: SkinId): Promise<SkinArtworkDescriptor | null>;
  resetSkinArtwork(skin: SkinId): Promise<void>;
  openProject(path: string, trusted: boolean): Promise<RuntimeBootstrap | null>;
  revealPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  copyText(value: string): Promise<void>;
  boardInitialize(): Promise<BoardBootstrap>;
  boardCreateTask(input: CreateTaskInput): Promise<BoardBootstrap>;
  boardLaunchTeamTask(input: LaunchTeamTaskInput): Promise<BoardBootstrap>;
  boardUpdateTask(input: UpdateTaskInput): Promise<BoardBootstrap>;
  boardMoveTask(taskId: string, stage: ManualTaskStage): Promise<BoardBootstrap>;
  boardDeleteTask(taskId: string): Promise<BoardBootstrap>;
  boardAddComment(input: CreateTaskCommentInput): Promise<BoardBootstrap>;
  boardCreateAgent(input: CreateProjectAgentInput): Promise<BoardBootstrap>;
  boardUpdateAgent(input: UpdateProjectAgentInput): Promise<BoardBootstrap>;
  boardDeleteAgent(agentId: string): Promise<BoardBootstrap>;
  boardCreateSquad(input: CreateSquadInput): Promise<BoardBootstrap>;
  boardUpdateSquad(input: UpdateSquadInput): Promise<BoardBootstrap>;
  boardDeleteSquad(squadId: string): Promise<BoardBootstrap>;
  boardCreateAutopilot(input: CreateAutopilotInput): Promise<BoardBootstrap>;
  boardUpdateAutopilot(input: UpdateAutopilotInput): Promise<BoardBootstrap>;
  boardDeleteAutopilot(autopilotId: string): Promise<BoardBootstrap>;
  boardTriggerAutopilot(autopilotId: string): Promise<BoardBootstrap>;
  boardDispatchTask(taskId: string): Promise<BoardBootstrap>;
  boardResolveGate(input: ResolveGateInput): Promise<BoardBootstrap>;
  boardReviewExecution(input: ReviewExecutionInput): Promise<BoardBootstrap>;
  boardAbortTask(taskId: string): Promise<BoardBootstrap>;
  openTaskSession(input: OpenTaskSessionInput): Promise<RuntimeBootstrap>;
  windowAction(action: "minimize" | "maximize" | "close"): Promise<void>;
  onEvent(listener: (event: BridgeEvent) => void): () => void;
}

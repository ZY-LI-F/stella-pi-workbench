// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PiCommand, PiResponse, RuntimeSignal } from "../../src/shared/contracts";
import { EMPTY_BOARD_STATE, parseBoardState, type BoardBridgeEvent, type BoardState } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { BoardService } from "../../src/main/board-service";
import type { BoardRepository } from "../../src/main/board-repository";
import { WorkflowOrchestrator, type WorkflowAgentRuntime, type WorkflowRuntimeFactory } from "../../src/main/workflow-orchestrator";
import { WorkspaceAdmission } from "../../src/main/workspace-admission";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

class FakeRuntime implements WorkflowAgentRuntime {
  running = false;
  readonly commands: PiCommand[] = [];
  readonly start = vi.fn(async () => { await this.startBehavior(); this.running = true; });
  readonly stop = vi.fn(async () => { this.running = false; });

  constructor(
    readonly callbacks: { readonly emitPiEvent: (event: unknown) => void; readonly emitRuntimeSignal: (signal: RuntimeSignal) => void },
    readonly output: string = "步骤产物",
    readonly startBehavior: () => Promise<void> = async () => undefined,
  ) {}

  async send(command: PiCommand): Promise<PiResponse> {
    this.commands.push(command);
    if (command.type === "get_last_assistant_text") return { id: "1", type: "response", command: "get_last_assistant_text", success: true, data: { text: this.output } };
    if (command.type === "get_state") return { id: "2", type: "response", command: "get_state", success: true, data: { thinkingLevel: "off", isStreaming: false, isCompacting: false, steeringMode: "all", followUpMode: "all", sessionFile: "C:/session.jsonl", sessionId: "session", autoCompactionEnabled: true, messageCount: 2, pendingMessageCount: 0 } };
    if (command.type === "get_session_stats") return { id: "3", type: "response", command: "get_session_stats", success: true, data: { sessionFile: "C:/session.jsonl", sessionId: "session", userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 }, cost: 0.01 } };
    if (command.type === "get_messages") return { id: "4", type: "response", command: "get_messages", success: true, data: { messages: [{ role: "assistant", stopReason: "stop", content: [], provider: "test", model: "test", timestamp: 1 }] } };
    if (command.type === "prompt") return { id: "5", type: "response", command: "prompt", success: true };
    throw new Error(`FakeRuntime 没有实现命令 ${command.type}`);
  }

  settle(): void { this.callbacks.emitPiEvent({ type: "agent_settled" }); }
}

class FakeRuntimeFactory implements WorkflowRuntimeFactory {
  readonly runtimes: FakeRuntime[] = [];
  constructor(readonly startBehavior: () => Promise<void> = async () => undefined) {}
  create(callbacks: ConstructorParameters<typeof FakeRuntime>[0]): WorkflowAgentRuntime {
    const runtime = new FakeRuntime(callbacks, "步骤产物", this.startBehavior);
    this.runtimes.push(runtime);
    return runtime;
  }
}

function idFactory(): () => string {
  let value = 0;
  return () => `id-${++value}`;
}

async function setup(
  runtimeFactory = new FakeRuntimeFactory(),
  globalModel: () => Readonly<{ readonly provider: string; readonly model: string }> | undefined = () => undefined,
) {
  const repository = new MemoryRepository();
  const events: BoardBridgeEvent[] = [];
  const admission = new WorkspaceAdmission({ canonicalize: async (path) => path.toLocaleLowerCase("en-US") });
  const id = idFactory();
  const service = new BoardService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, id, now: () => "2026-07-17T00:00:00.000Z" });
  await service.createTask({
    title: "实现固定流程", description: "真实执行", acceptanceCriteria: "经过人工关卡", priority: "high",
    projectPath: "C:/project", projectName: "project", trusted: true,
    executionTarget: { kind: "workflow", workflowId: "feature-delivery" },
  });
  const taskId = repository.state.tasks[0]?.id;
  if (!taskId) throw new Error("测试任务未创建");
  const orchestrator = new WorkflowOrchestrator({
    repository,
    catalog: BUILTIN_ORCHESTRATION_CATALOG,
    runtimeFactory,
    emitBoardEvent: (event) => events.push(event),
    admission,
    globalModel,
    id,
    now: () => "2026-07-17T00:00:00.000Z",
  });
  return { repository, runtimeFactory, events, orchestrator, admission, taskId };
}

describe("WorkflowOrchestrator", () => {
  it("inherits the application model for workflow Agents without overrides", async () => {
    const runtimeFactory = new FakeRuntimeFactory();
    const { orchestrator, taskId } = await setup(
      runtimeFactory,
      () => Object.freeze({ provider: "openai", model: "gpt-global" }),
    );

    await orchestrator.dispatch(taskId);

    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.start).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      model: "gpt-global",
    })));
  });

  it("runs isolated Agents in order and pauses at the plan gate", async () => {
    const { repository, runtimeFactory, orchestrator, taskId } = await setup();
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));

    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    expect(repository.state.runs[0]?.steps[0]?.status).toBe("succeeded");

    runtimeFactory.runtimes[1]?.settle();
    await vi.waitFor(() => expect(repository.state.runs[0]?.status).toBe("review"));
    expect(repository.state.tasks[0]?.stage).toBe("review");
    expect(repository.state.runs[0]?.currentStepId).toBe("approve-plan");

    await orchestrator.resolveGate({ taskId, decision: "approve", comment: "方案通过" });
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(3));
    await vi.waitFor(() => expect(runtimeFactory.runtimes[2]?.start).toHaveBeenCalledWith(expect.objectContaining({
      allowedTools: expect.arrayContaining(["edit", "write"]),
    })));
  });

  it("records an explicit interruption when the user aborts", async () => {
    const { repository, runtimeFactory, orchestrator, taskId } = await setup();
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    await orchestrator.abort(taskId);
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
    expect(repository.state.tasks[0]?.activeRunId).toBeUndefined();
    expect(repository.state.runs[0]?.status).toBe("interrupted");
    expect(repository.state.activities.at(-1)?.summary).toContain("中止");
  });

  it("does not send a prompt when abort wins a runtime-start race", async () => {
    let releaseStart: (() => void) | undefined;
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
    const runtimeFactory = new FakeRuntimeFactory(() => startGate);
    const { repository, orchestrator, taskId } = await setup(runtimeFactory);
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.start).toHaveBeenCalledOnce());
    await orchestrator.abort(taskId);
    releaseStart?.();
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.stop).toHaveBeenCalledTimes(2));
    expect(runtimeFactory.runtimes[0]?.running).toBe(false);
    expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(false);
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
  });

  it("keeps abort terminal when a late Agent settlement arrives", async () => {
    const { repository, runtimeFactory, orchestrator, taskId } = await setup();
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    const runtime = runtimeFactory.runtimes[0];
    await orchestrator.abort(taskId);
    runtime?.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
    expect(repository.state.runs[0]?.status).toBe("interrupted");
    expect(repository.state.runs[0]?.steps[0]?.artifact).toBeUndefined();
  });

  it("persists interruption before stopping active runtimes during shutdown", async () => {
    const { repository, runtimeFactory, orchestrator, taskId } = await setup();
    await orchestrator.dispatch(taskId);
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    await orchestrator.shutdown();
    expect(repository.state.tasks[0]?.stage).toBe("blocked");
    expect(repository.state.runs[0]?.status).toBe("interrupted");
    expect(runtimeFactory.runtimes[0]?.stop).toHaveBeenCalled();
  });
});

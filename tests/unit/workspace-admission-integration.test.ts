// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PiCommand, PiResponse, RuntimeSignal } from "../../src/shared/contracts";
import { EMPTY_BOARD_STATE, parseBoardState, type BoardState, type OrchestrationCatalog, type WorkflowDefinition } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { AgentTaskRunner, type AgentTaskRuntime, type AgentTaskRuntimeFactory } from "../../src/main/agent-task-runner";
import { AgentTaskService } from "../../src/main/agent-task-service";
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

class FakeRuntime implements AgentTaskRuntime, WorkflowAgentRuntime {
  running = false;
  readonly commands: PiCommand[] = [];
  readonly start = vi.fn(async () => { this.running = true; });
  readonly stop = vi.fn(async () => { this.running = false; });
  readonly abortAndStop = vi.fn(async () => { this.running = false; });

  constructor(readonly callbacks: { readonly emitPiEvent: (event: unknown) => void; readonly emitRuntimeSignal: (signal: RuntimeSignal) => void }) {}

  async send(command: PiCommand): Promise<PiResponse> {
    this.commands.push(command);
    if (command.type === "get_last_assistant_text") return { id: "text", type: "response", command: command.type, success: true, data: { text: "跨执行器真实产物" } };
    if (command.type === "get_state") return { id: "state", type: "response", command: command.type, success: true, data: { sessionFile: "C:/sessions/background.jsonl" } } as PiResponse;
    if (command.type === "get_session_stats") return { id: "stats", type: "response", command: command.type, success: true, data: { tokens: { input: 1, output: 2 }, cost: 0 } } as PiResponse;
    if (command.type === "get_messages") return { id: "messages", type: "response", command: command.type, success: true, data: { messages: [{ role: "assistant", stopReason: "stop" }] } } as PiResponse;
    if (command.type === "prompt") return { id: "prompt", type: "response", command: command.type, success: true };
    throw new Error(`未实现命令 ${command.type}`);
  }

  settle(): void { this.callbacks.emitPiEvent({ type: "agent_settled" }); }
}

class SharedRuntimeFactory implements WorkflowRuntimeFactory, AgentTaskRuntimeFactory {
  readonly runtimes: FakeRuntime[] = [];
  create(callbacks: ConstructorParameters<typeof FakeRuntime>[0]): FakeRuntime {
    const runtime = new FakeRuntime(callbacks);
    this.runtimes.push(runtime);
    return runtime;
  }
}

function idFactory(): () => string {
  let value = 0;
  return () => `cross-${++value}`;
}

const WRITE_WORKFLOW: WorkflowDefinition = Object.freeze({
  id: "write-only",
  version: 1,
  name: "写入串行验证",
  shortName: "写入验证",
  summary: "用于验证共享 Workspace Admission",
  teamId: "delivery-squad",
  steps: Object.freeze([
    Object.freeze({ kind: "agent" as const, id: "build", name: "写入项目", summary: "真实写入", agentId: "builder", objective: "修改项目" }),
  ]),
});

const CATALOG: OrchestrationCatalog = Object.freeze({
  ...BUILTIN_ORCHESTRATION_CATALOG,
  workflows: Object.freeze([...BUILTIN_ORCHESTRATION_CATALOG.workflows, WRITE_WORKFLOW]),
});

describe("shared WorkspaceAdmission integration", () => {
  it("does not launch AgentTask until a Workflow writer on the same canonical workspace releases", async () => {
    const repository = new MemoryRepository();
    const id = idFactory();
    const now = () => "2026-07-18T00:00:00.000Z";
    const admission = new WorkspaceAdmission({ canonicalize: async (path) => path.replaceAll("\\", "/").toLocaleLowerCase("en-US") });
    const workflowFactory = new SharedRuntimeFactory();
    const agentFactory = new SharedRuntimeFactory();
    const boardService = new BoardService({ repository, catalog: CATALOG, emitChanged: () => undefined, id, now });
    const agentTaskService = new AgentTaskService({ repository, catalog: CATALOG, emitChanged: () => undefined, id, now });
    const workflow = new WorkflowOrchestrator({
      repository,
      catalog: CATALOG,
      runtimeFactory: workflowFactory,
      admission,
      emitBoardEvent: () => undefined,
      globalModel: () => undefined,
      resolveProjectPath: async (projectPath) => projectPath,
      id,
      now,
    });
    const runner = new AgentTaskRunner({
      service: agentTaskService,
      runtimeFactory: agentFactory,
      admission,
      emitBoardEvent: () => undefined,
      globalModel: () => undefined,
      resolveProjectPath: async (projectPath) => projectPath,
    });

    await boardService.createTask({
      title: "Workflow writer", description: "", acceptanceCriteria: "", priority: "high",
      projectPath: "C:/Repo", projectName: "Repo", trusted: true,
      executionTarget: { kind: "workflow", workflowId: WRITE_WORKFLOW.id },
    });
    await boardService.createTask({
      title: "AgentTask writer", description: "", acceptanceCriteria: "", priority: "high",
      projectPath: "c:\\repo", projectName: "Repo", trusted: true,
      executionTarget: { kind: "agent", agentId: "builder" },
    });
    const workflowTask = repository.state.tasks.find((task) => task.title === "Workflow writer");
    const agentTask = repository.state.tasks.find((task) => task.title === "AgentTask writer");
    if (!workflowTask || !agentTask) throw new Error("测试任务未创建");

    await workflow.dispatch(workflowTask.id);
    await vi.waitFor(() => expect(workflowFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    await agentTaskService.dispatchDirect(agentTask.id);
    runner.start();

    await vi.waitFor(() => expect(repository.state.activities.some((activity) => activity.taskId === agentTask.id && activity.summary.includes("等待项目写入席位"))).toBe(true));
    expect(agentFactory.runtimes).toHaveLength(0);
    expect(repository.state.agentTasks.find((entry) => entry.taskId === agentTask.id)?.status).toBe("queued");

    workflowFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(agentFactory.runtimes).toHaveLength(1));
    await vi.waitFor(() => expect(agentFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    expect(repository.state.agentTasks.find((entry) => entry.taskId === agentTask.id)?.status).toBe("running");

    agentFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((entry) => entry.taskId === agentTask.id)?.status).toBe("reported"));
    await Promise.all([workflow.shutdown(), runner.shutdown()]);
    admission.shutdown();
  });
});

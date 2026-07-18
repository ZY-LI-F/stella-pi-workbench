// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { PiCommand, PiResponse, RuntimeSignal } from "../../src/shared/contracts";
import { EMPTY_BOARD_STATE, parseBoardState, type BoardState, type ExecutionTarget } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { AgentTaskRunner, type AgentTaskRuntime, type AgentTaskRuntimeFactory } from "../../src/main/agent-task-runner";
import { AgentTaskService } from "../../src/main/agent-task-service";
import { BoardService } from "../../src/main/board-service";
import type { BoardRepository } from "../../src/main/board-repository";
import { SquadService } from "../../src/main/squad-service";
import { WorkspaceAdmission } from "../../src/main/workspace-admission";

class MemoryRepository implements BoardRepository {
  state: BoardState = EMPTY_BOARD_STATE;
  async read(): Promise<BoardState> { return this.state; }
  async update(transform: (current: BoardState) => BoardState): Promise<BoardState> {
    this.state = parseBoardState(transform(this.state));
    return this.state;
  }
}

class FakeAgentRuntime implements AgentTaskRuntime {
  running = false;
  readonly commands: PiCommand[] = [];
  readonly start = vi.fn(async () => { await this.startBehavior(); this.running = true; });
  readonly stop = vi.fn(async () => { this.running = false; });
  readonly abortAndStop = vi.fn(async () => { this.running = false; });

  constructor(
    readonly callbacks: { readonly emitPiEvent: (event: unknown) => void; readonly emitRuntimeSignal: (signal: RuntimeSignal) => void },
    readonly output: string,
    readonly startBehavior: () => Promise<void>,
  ) {}

  async send(command: PiCommand): Promise<PiResponse> {
    this.commands.push(command);
    if (command.type === "get_last_assistant_text") return { id: "1", type: "response", command: command.type, success: true, data: { text: this.output } };
    if (command.type === "get_state") return { id: "2", type: "response", command: command.type, success: true, data: { thinkingLevel: "off", isStreaming: false, isCompacting: false, steeringMode: "all", followUpMode: "all", sessionFile: "C:/agent-task.jsonl", sessionId: "session", autoCompactionEnabled: true, messageCount: 2, pendingMessageCount: 0 } };
    if (command.type === "get_session_stats") return { id: "3", type: "response", command: command.type, success: true, data: { sessionFile: "C:/agent-task.jsonl", sessionId: "session", userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 12, output: 34, cacheRead: 0, cacheWrite: 0, total: 46 }, cost: 0.02 } };
    if (command.type === "get_messages") return { id: "4", type: "response", command: command.type, success: true, data: { messages: [{ role: "assistant", stopReason: "stop", content: [], provider: "test", model: "test", timestamp: 1 }] } };
    if (command.type === "prompt") return { id: "5", type: "response", command: command.type, success: true };
    throw new Error(`FakeAgentRuntime 没有实现命令 ${command.type}`);
  }

  settle(): void { this.callbacks.emitPiEvent({ type: "agent_settled" }); }
  exit(): void { this.callbacks.emitRuntimeSignal({ type: "runtime_exit", code: 1, signal: null }); }
}

class FakeAgentRuntimeFactory implements AgentTaskRuntimeFactory {
  readonly runtimes: FakeAgentRuntime[] = [];
  constructor(
    readonly output: string | readonly string[] = "真实 Agent 产物",
    readonly startBehavior: () => Promise<void> = async () => undefined,
  ) {}
  create(callbacks: ConstructorParameters<typeof FakeAgentRuntime>[0]): AgentTaskRuntime {
    const index = this.runtimes.length;
    const output = typeof this.output === "string" ? this.output : this.output[index] ?? this.output.at(-1) ?? "结果";
    const runtime = new FakeAgentRuntime(callbacks, output, this.startBehavior);
    this.runtimes.push(runtime);
    return runtime;
  }
}

function idFactory(): () => string {
  let value = 0;
  return () => `id-${String(++value).padStart(3, "0")}`;
}

async function setup(runtimeFactory = new FakeAgentRuntimeFactory()) {
  const repository = new MemoryRepository();
  const id = idFactory();
  const now = () => "2026-07-18T00:00:00.000Z";
  const boardService = new BoardService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, id, now });
  const agentTaskService = new AgentTaskService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, id, now });
  const squadService = new SquadService({ repository, catalog: BUILTIN_ORCHESTRATION_CATALOG, emitChanged: () => undefined, id, now });
  const events: unknown[] = [];
  const admission = new WorkspaceAdmission({ canonicalize: async (path) => path.toLocaleLowerCase("en-US") });
  const runner = new AgentTaskRunner({ service: agentTaskService, runtimeFactory, emitBoardEvent: (event) => events.push(event), admission });

  const createTask = async (title: string, executionTarget: ExecutionTarget = { kind: "agent", agentId: "builder" }) => {
    await boardService.createTask({
      title, description: "修改真实项目", acceptanceCriteria: "留下可验证结果", priority: "high",
      projectPath: "C:/project", projectName: "project", trusted: true,
      executionTarget,
    });
    const task = repository.state.tasks.find((candidate) => candidate.title === title);
    if (!task) throw new Error("测试任务未创建");
    return task.id;
  };

  return { repository, boardService, agentTaskService, squadService, runtimeFactory, runner, admission, events, createTask };
}

describe("AgentTaskRunner", () => {
  it("runs direct AgentTasks serially and persists output, stats, comments, and review state", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, createTask } = await setup();
    const firstTaskId = await createTask("第一个任务");
    const secondTaskId = await createTask("第二个任务");
    await agentTaskService.addComment({ taskId: firstTaskId, body: "请保留用户已有改动" });
    await agentTaskService.dispatchDirect(firstTaskId);
    await agentTaskService.dispatchDirect(secondTaskId);

    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    const prompt = runtimeFactory.runtimes[0]?.commands.find((command) => command.type === "prompt");
    expect(prompt).toMatchObject({ type: "prompt", message: expect.stringContaining("请保留用户已有改动") });
    expect(repository.state.agentTasks.filter((task) => task.status === "running")).toHaveLength(1);

    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    const first = repository.state.agentTasks.find((task) => task.taskId === firstTaskId);
    expect(first).toMatchObject({ status: "reported", acceptance: "pending", output: "真实 Agent 产物", sessionPath: "C:/agent-task.jsonl", inputTokens: 12, outputTokens: 34, cost: 0.02 });
    expect(repository.state.tasks.find((task) => task.id === firstTaskId)?.stage).toBe("planned");
    expect(repository.state.comments.some((comment) => comment.taskId === firstTaskId && comment.author === "agent" && comment.body === "真实 Agent 产物")).toBe(true);
    expect(repository.state.agentTasks.find((task) => task.taskId === secondTaskId)?.status).toBe("running");
  });

  it("keeps user abort terminal when a late settlement arrives", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, createTask } = await setup();
    const taskId = await createTask("可中止任务");
    await agentTaskService.dispatchDirect(taskId);
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));
    const runtime = runtimeFactory.runtimes[0];
    await runner.abortTask(taskId);
    runtime?.settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("planned");
    expect(repository.state.agentTasks.find((task) => task.taskId === taskId)?.status).toBe("interrupted");
    expect(repository.state.comments.some((comment) => comment.author === "agent")).toBe(false);
    expect(runtime?.abortAndStop).toHaveBeenCalledOnce();
  });

  it("cancels a workspace waiter without launching it after the owner releases", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, admission, createTask } = await setup();
    const owner = await admission.acquireInteractive("C:/project", {
      id: "interactive-owner",
      kind: "interactive",
      label: "Interactive Pi",
    });
    const taskId = await createTask("排队后取消");
    await agentTaskService.dispatchDirect(taskId);
    runner.start();
    await vi.waitFor(() => expect(repository.state.activities.some((activity) => activity.taskId === taskId && activity.summary.includes("等待项目写入席位"))).toBe(true));

    await runner.abortTask(taskId);
    owner.release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtimeFactory.runtimes).toHaveLength(0);
    expect(repository.state.agentTasks.find((task) => task.taskId === taskId)?.status).toBe("cancelled");
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("planned");
  });

  it("persists startup failures and continues with the next queued AgentTask", async () => {
    let starts = 0;
    const runtimeFactory = new FakeAgentRuntimeFactory("结果", async () => {
      starts += 1;
      if (starts === 1) throw new Error("无法启动真实 Pi Runtime");
    });
    const { repository, agentTaskService, runner, createTask } = await setup(runtimeFactory);
    const firstTaskId = await createTask("启动失败任务");
    const secondTaskId = await createTask("继续执行任务");
    await agentTaskService.dispatchDirect(firstTaskId);
    await agentTaskService.dispatchDirect(secondTaskId);
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    expect(repository.state.agentTasks.find((task) => task.taskId === firstTaskId)).toMatchObject({ status: "failed", error: "无法启动真实 Pi Runtime" });
    expect(repository.state.agentTasks.find((task) => task.taskId === secondTaskId)?.status).toBe("running");
  });

  it("rejects an unsafe read-only tool snapshot before creating a Runtime", async () => {
    const { repository, agentTaskService, runtimeFactory, runner, createTask } = await setup();
    const taskId = await createTask("伪只读权限");
    await agentTaskService.dispatchDirect(taskId);
    await repository.update((current) => ({
      ...current,
      agentTasks: current.agentTasks.map((agentTask) => agentTask.taskId === taskId
        ? Object.freeze({
            ...agentTask,
            agentSnapshot: Object.freeze({
              ...agentTask.agentSnapshot,
              workspaceAccess: "read" as const,
              allowedTools: Object.freeze(["read", "bash"]),
            }),
          })
        : agentTask),
    }));

    runner.start();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((agentTask) => agentTask.taskId === taskId)?.status).toBe("failed"));
    expect(runtimeFactory.runtimes).toHaveLength(0);
    expect(repository.state.agentTasks.find((agentTask) => agentTask.taskId === taskId)?.error).toContain("未验证工具: bash");
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("planned");
  });

  it("turns user comment mentions into one serial parent-child execution group", async () => {
    const { repository, agentTaskService, createTask } = await setup();
    const taskId = await createTask("评论委派任务");
    await agentTaskService.addComment({ taskId, body: "请由 @builder 完成，再请 @VERIFY 核验；重复 @BUILD 不应重复入队" });
    const group = repository.state.agentTasks.filter((task) => task.taskId === taskId);
    expect(group).toHaveLength(2);
    expect(group[0]).toMatchObject({ kind: "mention-root", status: "queued", agentSnapshot: { id: "builder" } });
    expect(group[1]).toMatchObject({ kind: "delegated", parentAgentTaskId: group[0]?.id, agentSnapshot: { id: "tester" } });
    expect(repository.state.tasks.find((task) => task.id === taskId)?.activeAgentTaskId).toBe(group[0]?.id);

    const before = repository.state;
    await expect(agentTaskService.addComment({ taskId, body: "请交给 @missing" })).rejects.toThrow("未知 Agent mention");
    expect(repository.state.comments).toHaveLength(before.comments.length);
    expect(repository.state.agentTasks).toHaveLength(before.agentTasks.length);
  });

  it("executes Squad Leader mentions as real children and completes only after every child", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory(["需要 @builder 与 @VERIFY 继续执行", "实现完成", "验证完成"]);
    const { repository, agentTaskService, squadService, runner, createTask } = await setup(runtimeFactory);
    await squadService.create({
      name: "动态交付组",
      description: "Leader 动态路由",
      leaderAgentId: "planner",
      memberAgentIds: ["builder", "tester"],
      leaderInstructions: "根据任务决定需要的成员并使用精确 mention。",
    });
    const squad = repository.state.squads[0];
    if (!squad) throw new Error("测试 Squad 未创建");
    const taskId = await createTask("Squad 任务", { kind: "squad", squadId: squad.id });
    await agentTaskService.dispatchSquad(taskId);
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes[0]?.commands.some((command) => command.type === "prompt")).toBe(true));

    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    const leader = repository.state.agentTasks.find((task) => task.kind === "squad-leader");
    const children = repository.state.agentTasks.filter((task) => task.parentAgentTaskId === leader?.id);
    expect(leader?.status).toBe("waiting_children");
    expect(children.map((child) => child.agentSnapshot.id)).toEqual(["builder", "tester"]);
    expect(repository.state.tasks.find((task) => task.id === taskId)?.activeAgentTaskId).toBe(leader?.id);

    runtimeFactory.runtimes[1]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(3));
    expect(repository.state.agentTasks.find((task) => task.id === leader?.id)?.status).toBe("waiting_children");
    runtimeFactory.runtimes[2]?.settle();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.id === leader?.id)?.status).toBe("reported"));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("planned");
    expect(repository.state.agentTasks.find((task) => task.id === leader?.id)).toMatchObject({ status: "reported", acceptance: "pending" });
    expect(repository.state.comments.filter((comment) => comment.taskId === taskId && comment.author === "agent")).toHaveLength(3);
  });

  it("fails the Squad parent and cancels queued siblings when one child fails", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory(["委派 @builder @VERIFY", "不会使用"]);
    const { repository, agentTaskService, squadService, runner, createTask } = await setup(runtimeFactory);
    await squadService.create({
      name: "失败传播组",
      description: "测试失败传播",
      leaderAgentId: "planner",
      memberAgentIds: ["builder", "tester"],
      leaderInstructions: "委派两个成员。",
    });
    const squad = repository.state.squads[0];
    if (!squad) throw new Error("测试 Squad 未创建");
    const taskId = await createTask("失败传播", { kind: "squad", squadId: squad.id });
    await agentTaskService.dispatchSquad(taskId);
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    runtimeFactory.runtimes[1]?.exit();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.kind === "squad-leader")?.status).toBe("failed"));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("planned");
    const leader = repository.state.agentTasks.find((task) => task.kind === "squad-leader");
    const children = repository.state.agentTasks.filter((task) => task.parentAgentTaskId === leader?.id);
    expect(leader?.status).toBe("failed");
    expect(children.map((child) => child.status)).toEqual(["failed", "cancelled"]);
  });

  it("reconciles a waiting parent when startup recovery finds an interrupted child", async () => {
    const runtimeFactory = new FakeAgentRuntimeFactory(["委派 @builder @VERIFY", "不会结算"]);
    const { repository, agentTaskService, squadService, runner, admission, createTask } = await setup(runtimeFactory);
    await squadService.create({
      name: "恢复检查组",
      description: "测试重启恢复",
      leaderAgentId: "planner",
      memberAgentIds: ["builder", "tester"],
      leaderInstructions: "委派两个成员。",
    });
    const squad = repository.state.squads[0];
    if (!squad) throw new Error("测试 Squad 未创建");
    const taskId = await createTask("恢复父任务", { kind: "squad", squadId: squad.id });
    await agentTaskService.dispatchSquad(taskId);
    runner.start();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(1));
    runtimeFactory.runtimes[0]?.settle();
    await vi.waitFor(() => expect(runtimeFactory.runtimes).toHaveLength(2));
    const runningChild = repository.state.agentTasks.find((task) => task.status === "running");
    if (!runningChild) throw new Error("测试子任务未运行");
    await repository.update((current) => ({
      ...current,
      agentTasks: current.agentTasks.map((task) => task.id === runningChild.id
        ? Object.freeze({ ...task, status: "interrupted" as const, runtimeToken: undefined, error: "应用重启", updatedAt: "2026-07-18T00:01:00.000Z", completedAt: "2026-07-18T00:01:00.000Z" })
        : task),
    }));

    const recoveredRunner = new AgentTaskRunner({ service: agentTaskService, runtimeFactory: new FakeAgentRuntimeFactory(), emitBoardEvent: () => undefined, admission });
    recoveredRunner.start();
    await vi.waitFor(() => expect(repository.state.agentTasks.find((task) => task.kind === "squad-leader")?.status).toBe("failed"));
    expect(repository.state.tasks.find((task) => task.id === taskId)?.stage).toBe("planned");
    const leader = repository.state.agentTasks.find((task) => task.kind === "squad-leader");
    expect(leader?.status).toBe("failed");
    expect(repository.state.agentTasks.filter((task) => task.parentAgentTaskId === leader?.id).map((task) => task.status)).toEqual(["interrupted", "cancelled"]);
  });
});

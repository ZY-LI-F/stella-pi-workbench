# Stella 本地 Agent 自动化 Spec

> 状态：Approved / Ready for agent  
> 日期：2026-07-17  
> 目标：先交付固定 Kanban + 本地持久化 AgentTaskQueue + Squad 动态委派 + Manual / Schedule / Webhook Autopilot + 内置 Pi RPC Runner。

本 Spec 是 `stella-v2-simple-technical-spec.md` 的可独立交付增量。对于该旧文档中把动态 Squad、计划和 Webhook列为“暂不实现”的条目，以本 Spec 为准；Project、可配置列和可视化 DAG 仍不在本次实现范围。

## Problem Statement

当前 Stella 已能创建看板任务、选择固定 Workflow、串行运行内置 Agent 并处理人工关卡，但每次执行都必须由用户手工点击固定流程。任务没有评论、独立 Agent 执行队列或动态小队，应用也不能把重复任务固化成手动、周期或本机 Webhook 自动化。

直接引入 Multica 风格的 PostgreSQL、服务端队列和独立 Daemon 会破坏当前产品“下载即用”的 Windows/macOS 桌面交付方式，也会让接收安装包的人额外维护数据库、端口和全局 Pi CLI。目标是在不扩张成通用自动化平台的前提下，先获得同等关键语义：持久队列、Leader 动态委派、可审计触发和真实 Agent 执行。

## Solution

把现有 Board State 升级为 schema v2，并在同一份经过验证、原子写入的本地状态中增加：

1. `TaskComment`：保存用户和 Agent 的任务讨论；用户评论中的有效 `@mention` 可创建 AgentTask。
2. `AgentTask`：独立于 Kanban Task 和 Workflow Run 的持久执行队列，支持根任务、Squad Leader、子委派、终态和 Pi 产物。
3. `Squad`：保存 Leader、成员和 Leader 指令；Leader 输出的成员 `@mention` 会生成串行子任务。
4. `Autopilot` / `AutopilotRun`：保存创建任务的模板、执行目标、手动/周期/Webhook 触发配置和每次触发审计。
5. `AgentTaskRunner`：Electron 主进程内的单执行者，调用安装包内置的 Pi 0.80.10 RPC entry；不查找全局 CLI。
6. 应用运行期间的 `ScheduleRunner` 与仅监听 `127.0.0.1` 的 Webhook Server。

固定 Workflow 的已有能力保持不变。任务新增执行目标，用户可选择固定 Workflow、单个 Agent 或一个 Squad；三种分发入口共享同一张看板和任务详情。

## User Stories

1. As a Stella user, I want to choose a fixed Workflow, a single Agent, or a Squad for a task, so that simple work does not require a workflow and dynamic work does not pretend to be deterministic.
2. As a Stella user, I want every Agent execution to exist as a persisted AgentTask, so that queued, running, delegated, failed, interrupted, and successful work is visible after UI refreshes.
3. As a Stella user, I want queued AgentTasks to survive application restarts, so that closing Stella does not discard work I have not started.
4. As a Stella user, I want running AgentTasks to become explicitly interrupted on shutdown or restart, so that stale work is never reported as still running or successful.
5. As a Stella user, I want terminal AgentTask states to reject late Runtime callbacks, so that an abort cannot later turn into success.
6. As a Stella user, I want only one queued AgentTask to own the automation Runner at a time, so that two dynamic agents never edit the same workspace concurrently.
7. As a Stella user, I want to inspect the AgentTask session, final output, timestamps, errors, parent, and children from task detail, so that delegation stays explainable.
8. As a Stella user, I want to add normal comments to a task, so that intent and review notes remain attached to the work.
9. As a Stella user, I want `@builder` in a user comment to enqueue the matching member, so that I can delegate without opening another dialog.
10. As a Stella user, I want invalid or ambiguous mentions to fail visibly without partially enqueueing work, so that spelling mistakes do not silently route to the wrong Agent.
11. As a Stella user, I want to create a Squad with one Leader and selected members, so that reusable dynamic teams can be named and understood.
12. As a Squad Leader, I want a prompt containing the task, acceptance criteria, comments, member aliases, and delegation rules, so that I can decide whether another specialist is needed.
13. As a Stella user, I want Leader output containing member mentions to create child AgentTasks, so that dynamic delegation results in real queued executions rather than text pretending work occurred.
14. As a Stella user, I want a Leader with children to remain `waiting_children` until every child is terminal, so that the root result is not complete too early.
15. As a Stella user, I want one failed child to fail its Leader and task explicitly, so that partial Squad failure cannot be hidden.
16. As a Stella user, I want to create a Manual Autopilot that stores a task template and execution target, so that a recurring playbook can be launched with one click.
17. As a Stella user, I want every Autopilot trigger to create a fresh Kanban Task and then dispatch it, so that each run has independent history.
18. As a Stella user, I want a periodic Autopilot to run only while Stella is open, so that the desktop app remains honest about not being a background service.
19. As a Stella user, I want an elapsed schedule discovered at startup to create an explicit `missed` audit record and compute the next occurrence, so that downtime is visible rather than silently replayed.
20. As a local tool author, I want to POST JSON to a loopback Webhook URL, so that scripts on my machine can create and dispatch Stella work.
21. As a Stella user, I want each Webhook Autopilot to have an unguessable token in its URL, so that unrelated local requests cannot trigger it by name alone.
22. As a Stella user, I want malformed JSON, an unknown token, an oversized body, or a failed action to return an explicit HTTP error and write an audit record where applicable, so that integration failures are debuggable.
23. As a recipient of the installer, I want the Runner to launch bundled Pi from Stella's own installation, so that my local `pi` installation path is irrelevant.
24. As a user of Stella, 晨曦, or 定阳, I want queue, Squad, Autopilot, Webhook, comments, empty states, errors, focus states, and narrow layouts to be fully styled, so that automation never looks like a bolted-on admin panel.

## Domain Model

```text
Task {
  ...existingFields
  executionTarget:
    | { kind: "workflow", workflowId }
    | { kind: "agent", agentId }
    | { kind: "squad", squadId }
  activeRunId?
  activeAgentTaskId?
}

TaskComment {
  id, taskId
  author: "user" | "agent" | "system"
  authorAgentId?
  body
  createdAt
}

AgentTask {
  id, taskId, agentSnapshot
  kind: "direct" | "squad-leader" | "delegated"
  status: "queued" | "running" | "waiting_children" |
          "succeeded" | "failed" | "interrupted" | "cancelled"
  parentAgentTaskId?
  squadId?
  prompt
  runtimeToken?
  sessionPath?, output?, error?
  createdAt, updatedAt, startedAt?, completedAt?
}

Squad {
  id, name, description
  leaderAgentId
  memberAgentIds[]
  leaderInstructions
  createdAt, updatedAt
}

Autopilot {
  id, name, enabled
  trigger:
    | { kind: "manual" }
    | { kind: "schedule", intervalMinutes, nextRunAt }
    | { kind: "webhook", token }
  taskTemplate
  projectPath, projectName, trusted
  executionTarget
  createdAt, updatedAt
}

AutopilotRun {
  id, autopilotId
  triggerKind: "manual" | "schedule" | "webhook"
  status: "running" | "succeeded" | "failed" | "missed"
  taskId?, requestPayload?, error?
  startedAt, completedAt?
}
```

Run records snapshot the selected Agent definition before execution. Updating the built-in catalog or a Squad does not rewrite queued or historical AgentTasks.

## State Rules

### AgentTask Queue

1. New AgentTasks enter `queued` and are ordered by `createdAt`, then `id`.
2. The Runner atomically re-reads Board State, claims exactly one oldest queued AgentTask and sets a fresh `runtimeToken` before launching Pi.
3. Only the AgentTask whose persisted `runtimeToken` matches the active Runtime may process its events.
4. `succeeded`, `failed`, `interrupted`, and `cancelled` are terminal. A terminal task never transitions again.
5. A direct or delegated AgentTask success writes an Agent comment containing the final output.
6. A Squad Leader success is parsed for exact, case-insensitive member aliases in the form `@agent-id` or `@callsign`. Duplicate mentions enqueue one child only, in first-appearance order.
7. If a Leader emits no member mention it succeeds immediately. If it emits valid mentions it becomes `waiting_children` and the children enter `queued`.
8. When all children succeed, the Leader succeeds. If any child fails, is interrupted, or is cancelled, the Leader fails with a summary of child outcomes.
9. Root success moves the Kanban Task to `review`; root failure/interruption/cancellation moves it to the corresponding visible Task status. Existing fixed Workflow behavior remains unchanged.
10. On app shutdown, the persisted AgentTask is changed to `interrupted` before its Pi process is stopped. On startup, any residual `running` AgentTask is also changed to `interrupted`; `queued` and `waiting_children` records remain.

### Comments and Mentions

1. Empty comments are rejected.
2. Stella validates every token beginning with `@` against aliases available for the task's selected Squad, or against the built-in Agent catalog for non-Squad tasks.
3. Unknown or ambiguous aliases reject the whole comment command before persisting the comment or AgentTasks.
4. A valid comment is persisted once, then its distinct mentions create direct/delegated AgentTasks in textual order.
5. Mentions inside Agent output are interpreted only for `squad-leader` AgentTasks; normal Agent output remains plain content.

### Autopilot

1. Triggering an enabled Autopilot creates one `AutopilotRun`, one fresh Task, then dispatches its snapshotted execution target.
2. Every failure remains in the audit log with the exact message; partially created state is not presented as success.
3. Manual Autopilots run only from an explicit user action.
4. Schedule Autopilots use a positive integer interval in minutes. They run while the app is open. Startup records one `missed` run for an elapsed `nextRunAt`, advances `nextRunAt` to the first future occurrence, and does not backfill multiple tasks.
5. Webhook Autopilots listen only on `127.0.0.1`. The default port is `43127` and can be changed with `STELLA_WEBHOOK_PORT`; a bind conflict is surfaced, not replaced with a random port.
6. The endpoint is `POST /api/autopilots/webhook/{token}` with `application/json`. A token is generated from cryptographic randomness when the rule is created.
7. The default body limit is 1 MiB to protect the local process and is explicitly configurable with `STELLA_WEBHOOK_MAX_BYTES`; `0` disables the limit. Invalid UTF-8/JSON and non-object JSON are rejected.
8. The Webhook server exists only while Stella is running and closes during application shutdown.

## Implementation Decisions

1. Keep Electron main as the only authority for persistence, Runner lifetime, scheduling, loopback networking, project trust and Pi child processes.
2. Keep one Board Repository and JSON atomic write implementation. Schema v2 models PostgreSQL-style queue semantics; it does not pretend to be a multi-process database.
3. Add a startup v1-to-v2 migration. Before replacing v1, write a timestamped backup. Migration maps every legacy `workflowId` to `executionTarget: { kind: "workflow" }` and initializes new collections empty.
4. Keep the typed preload boundary. Renderer receives serializable Board Bootstrap snapshots and never imports Node APIs.
5. Keep existing `WorkflowOrchestrator`. Add a separate `AgentTaskService` for queue/domain commands and an `AgentTaskRunner` for Pi lifecycle.
6. Inject Repository, catalog, Runtime factory, clock and ID generator into services. Business logic does not instantiate concrete storage or Runtime classes.
7. Reuse Pi RPC start options from snapshotted Agent Definition. The prompt contains the task, acceptance criteria, recent comments, parent output when delegated, and explicit role instructions.
8. Add `PiRpcRuntime.abortAndStop()` that sends Pi `abort` where possible and always exposes a failed stop; errors are logged and surfaced through persisted state, never swallowed as success.
9. Use one in-process schedule timer that computes due rules from persisted timestamps; no cron parser or timer dependency is added.
10. Use Node's built-in HTTP and crypto modules for the loopback server and tokens; no web framework is added.
11. Request Electron's single-instance lock before creating services, so two desktop processes cannot mutate the same Board file or bind the Webhook port.
12. Preserve full Board Snapshot events after each committed change. Live Agent events include `agentTaskId` when emitted by the queue Runner.
13. The automation UI is embedded in the existing Kanban workspace: task detail gains discussion and execution tracks; a compact Automation Studio manages Squads and Autopilots. No second application shell is introduced.
14. New UI uses existing semantic skin tokens. Stella uses deep-space cyan/violet pulses, 晨曦 uses paper/sunrise ribbons, 定阳 uses ink/vermilion seals; all keep their existing signatures and typography.

## Testing Decisions

The primary seam is a temporary Board Repository plus controllable fake Pi Runtime and clock. Tests assert committed state and public outputs, not private implementation details.

Required tests:

1. Parse valid schema v2 and reject malformed TaskComment, AgentTask, Squad, Autopilot and AutopilotRun records.
2. Migrate valid v1 once, create a backup, preserve all tasks/runs/activities and reject malformed v1 without replacing it.
3. Recover residual `running` AgentTasks as `interrupted`, while keeping `queued` and `waiting_children`.
4. Atomically claim only the oldest queued AgentTask and never start two fake Runtimes concurrently.
5. Persist real Pi session/output/stats on success and explicit error on failure.
6. Prove abort versus late completion leaves the AgentTask terminal.
7. Validate comments before writing, enqueue distinct mentions in order and reject unknown/ambiguous aliases atomically.
8. Parse Squad Leader mentions, create children once, wait for all children, succeed on all success and fail on any terminal child failure.
9. Trigger Manual Autopilot into a fresh Task and root AgentTask/Workflow Run.
10. Run a due schedule once while open, record an elapsed startup occurrence as `missed`, and advance its next timestamp.
11. Accept a valid loopback JSON POST, reject invalid method/token/content/body, and persist failed action audits.
12. Validate main-process IPC inputs for all commands.
13. Render execution target selection, comments, queue tracks, Squad forms, Autopilot forms/runs and webhook URL in all three skins.
14. Run `npm run check`, production build, and packaged Windows end-to-end boot plus automation bridge smoke tests.

## Out of Scope

- PostgreSQL, SQLite, Redis, a remote backend, a second worker process or an independently installed Daemon.
- Execution while Stella is closed, OS startup agents, background services and catch-up task storms.
- Cron expressions, calendars, time zones, recurrence exceptions and distributed scheduling.
- Public-network Webhooks, reverse proxies, TLS termination and third-party connector authentication.
- Arbitrary Webhook-to-field mapping; payload is saved as trigger context and appended to the task description.
- Multi-user accounts, RBAC, cloud sync, remote collaboration and queue leasing across machines.
- Unlimited recursive delegation, agent-created Squads, cyclic parentage, retries and automatic retry policy.
- Project entities, configurable Kanban columns, custom fields, user-defined Agent catalog and visual DAG. These remain separate milestones.
- Parallel AgentTask execution. Queue children are intentionally serial.

## Further Notes

- This is a clean-room Stella implementation informed by the queue/leader/trigger concepts found in Multica; it does not copy Multica's source or platform topology.
- The installed application always resolves Pi from its bundled Node dependency. Project workspace paths remain local per computer, as in the current product.
- `Team` continues to mean deterministic Workflow roles. Dynamic routing must use `Squad`; UI labels and persisted records must not blur the terms.

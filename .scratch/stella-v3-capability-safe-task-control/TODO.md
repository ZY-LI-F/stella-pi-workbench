# Stella v3 Capability-safe Task Control · Ticket Todo List

此清单是本轮实现的唯一工作前沿。任何时候只允许一个 Ticket 为 `IN PROGRESS`；只有全部验收项和对应自动化检查通过后才能标记 `DONE`。

- [x] [01 · 建立 Board v3 真状态与无损迁移基线](issues/01-v3-schema-and-migration.md) — DONE
- [x] [02 · 独立 Capability Health 与启动故障隔离](issues/02-independent-capability-health.md) — DONE
- [x] [03 · Interactive Pi、Workflow 与 AgentTask 共用 Workspace Admission](issues/03-shared-workspace-admission.md) — DONE
- [x] [04 · 分离 Execution Report、Acceptance 与 Task Stage](issues/04-execution-report-and-acceptance.md) — DONE
- [x] [05 · 将 Task Detail 升级为 Task Room 时间线投影](issues/05-task-room-timeline-projection.md) — DONE
- [x] [06 · 显式 Pi↔Task 桥接与后台会话隔离](issues/06-explicit-pi-task-bridges.md) — DONE
- [x] [07 · 从持久 Execution 快照生成只读可视化 DAG](issues/07-read-only-visual-dag.md) — DONE
- [x] [08 · 完整回归、安装包与发布门禁](issues/08-packaged-release-gates.md) — DONE

## Frontier

- 当前：全部 Ticket 已完成。
- Ticket 01 完成后：Ticket 02、03、04 均解除阻塞；为保持单前沿，按 02 → 03 → 04 执行。
- Ticket 04 完成后：Ticket 05 → Ticket 06，然后 Ticket 07。
- 所有功能 Ticket 完成后：Ticket 08。

## Definition of Done

- 所有 Ticket 文件的 Acceptance Criteria 已勾选，状态为 `DONE`。
- Board v2 数据有可测试的无损 v3 迁移和备份。
- Pi、Task、Schedule、Webhook 的错误域独立且错误显式。
- Interactive Pi、Workflow、AgentTask 不能并发写同一 canonical workspace。
- `reported` 与 `accepted` 在领域状态、IPC 和 UI 中明确分离。
- Task Room 只是时间线投影；没有 TaskRoom 持久实体。
- Pi↔Task 只通过显式动作桥接，后台 session 不污染普通历史。
- DAG 只读且来自同一持久 Execution 快照。
- `npm run check`、`npm run build` 和 packaged smoke 通过。
- 发布 CI 在上传 Windows/macOS 安装包前执行完整门禁。

# Stella Local Agent Automation · Ticket Todo List

此清单是本轮实现的工作前沿；任何时候只允许一个 ticket 处于 `IN PROGRESS`。

- [x] [01 · 运行终态、单实例与存储迁移基线](issues/01-runtime-terminal-single-instance-and-migration.md) — DONE
- [x] [02 · Task Comment、AgentTaskQueue 与手动 Agent 分发](issues/02-comments-agent-task-queue-direct-dispatch.md) — DONE
- [x] [03 · Squad Leader 与 @mention 动态委派闭环](issues/03-squad-leader-mention-delegation.md) — DONE
- [x] [04 · Manual Autopilot](issues/04-manual-autopilot.md) — DONE
- [x] [05 · 应用运行期间的 Schedule Autopilot](issues/05-open-app-schedule-autopilot.md) — DONE
- [x] [06 · Loopback Webhook、三套皮肤 UI 与原生验证](issues/06-loopback-webhook-skins-packaged-verification.md) — DONE

## Definition of Done

- 所有 ticket checklist 已勾选并将状态改为 `DONE`。
- `npm run check`、`npm run build` 和 `npm run test:packaged` 通过。
- 任何失败都有显式错误或持久化审计，没有 mock 成功、静默跳过或伪后台在线。

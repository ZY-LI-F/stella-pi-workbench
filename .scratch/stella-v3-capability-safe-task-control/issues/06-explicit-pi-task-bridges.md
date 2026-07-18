# 06 — 显式 Pi↔Task 桥接与后台会话隔离

**What to build:** 用户可以审阅后把当前 Pi 上下文固化为 Task，也可以从 Task 明确打开某个执行会话；普通 Pi 操作不改 Board，后台执行会话不会自动污染普通 Pi 历史。

**Blocked by:** 02 — 独立 Capability Health 与启动故障隔离；05 — 将 Task Detail 升级为 Task Room 时间线投影。

**Status:** DONE

- [x] Pi Workspace 提供显式“固化为任务”入口并打开可编辑草稿。
- [x] 新 Task 保存 source Pi session identity，但不自动 dispatch。
- [x] Task timeline 对有 session path 的执行提供“在 Pi 中继续”。
- [x] 切换只发生在用户选定的 session，不注入当前会话。
- [x] 后台 session 使用稳定 marker 并从普通历史中过滤。
- [x] 完整 Pi 操作矩阵不会创建或修改 Task/AgentTask。
- [x] bridge、history filter、renderer 与 E2E 测试通过。

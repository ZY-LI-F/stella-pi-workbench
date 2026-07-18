# 03 — Interactive Pi、Workflow 与 AgentTask 共用 Workspace Admission

**What to build:** 所有写能力在同一规范化工作区上经过一个主进程 Lease 仲裁；后台工作按 FIFO 等待，Interactive Pi 冲突得到明确拒绝，abort 和 shutdown 不会遗留幽灵 Lease 或稍后误启动的任务。

**Blocked by:** 01 — 建立 Board v3 真状态与无损迁移基线。

**Status:** DONE

- [x] Workspace key 使用 canonical absolute path 与平台大小写规则。
- [x] 一个注入的 WorkspaceAdmission 被三种执行入口共同使用。
- [x] Workflow 与 AgentTask 同工作区不能并发启动 Runtime。
- [x] Interactive prompt/steer/follow-up/bash 在后台占用时返回含 owner 的显式错误。
- [x] 后台执行在 Interactive turn 期间等待并显示等待状态。
- [x] queued waiter 可 abort，所有 settle/fail/abort/shutdown 路径释放 Lease。
- [x] read-only 定义的实际工具权限在启动前验证。
- [x] 单元、跨执行器集成和交互冲突测试通过。

验证：`npm run check`，16 个测试文件、68 个测试全部通过。

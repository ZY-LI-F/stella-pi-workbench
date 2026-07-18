# 02 — 独立 Capability Health 与启动故障隔离

**What to build:** Stella Shell 先于可选服务启动；Pi、Task、Schedule 与 Webhook 分别显示真实健康状态，一个能力损坏时其他能力仍可使用，不再因为 Board、Schedule 或 Webhook 错误退出整个应用。

**Blocked by:** 01 — 建立 Board v3 真状态与无损迁移基线。

**Status:** DONE

- [x] 主窗口与 IPC 在可选 Task 服务初始化前可用。
- [x] Board 解析/迁移失败时 Pi Workspace 完整可用，Task Control 显示原始错误。
- [x] Pi 初始化失败时 Task 历史仍可查看，执行入口明确禁用。
- [x] Webhook bind 和 Schedule start 错误只降级对应 Capability。
- [x] Capability Health 可通过 typed preload 查询并通过事件更新。
- [x] 主进程故障注入、renderer error state 与重试测试通过。

验证：`npm run check`，14 个测试文件、57 个测试全部通过。

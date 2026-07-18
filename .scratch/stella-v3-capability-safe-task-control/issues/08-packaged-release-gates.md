# 08 — 完整回归、安装包与发布门禁

**What to build:** Windows/macOS 发布流程用真实构建和打包烟测证明内置 Pi、Capability 隔离、v3 迁移、Workspace Admission、Task 时间线、显式桥接和 DAG 均可工作，不依赖目标机器的全局 Pi 或 Node。

**Blocked by:** 02 — 独立 Capability Health 与启动故障隔离；03 — Interactive Pi、Workflow 与 AgentTask 共用 Workspace Admission；04 — 分离 Execution Report、Acceptance 与 Task Stage；05 — 将 Task Detail 升级为 Task Room 时间线投影；06 — 显式 Pi↔Task 桥接与后台会话隔离；07 — 从持久 Execution 快照生成只读可视化 DAG。

**Status:** DONE

- [x] `npm run check` 与 production build 通过。
- [x] packaged smoke 覆盖 bundled Pi resolution、Pi Workspace 与 Task Control 启动。
- [x] 故障注入、跨执行器冲突和 false-success 回归通过。
- [x] Windows x64 打包应用在无全局 Pi 的环境中启动并完成核心烟测。
- [x] macOS x64/arm64 release jobs 在构建后运行原生 packaged smoke。
- [x] release workflow 在上传 installer 前执行 typecheck、unit 和 packaged checks。
- [x] README、权威 Spec、Ticket 状态和截图说明与最终行为一致。

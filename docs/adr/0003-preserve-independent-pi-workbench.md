# ADR 0003：保留独立且完整的 Pi 工作台

Stella 采用彼此并列的“双平面”产品结构：现有 Pi 工作台继续提供完整、可独立使用的交互式 Pi 能力；Kanban、Task Room、Coordinator、DAG 和 Autopilot 属于可选的任务控制台。新增任务能力不得要求用户先创建 Task，不得把普通 Pi 消息自动转成 AgentTask，也不得复用或劫持当前交互式 Pi 会话；这是为了持续兼容 Pi 的完整使用方式，同时让 Stella 只在用户明确固化或分发工作时承担编排责任。

## 兼容性不变量

- 用户不创建任何 Task，也能进入并完整使用 Pi 工作台。
- 当前 Pi 能力均属于不可回归的兼容面：项目选择与信任、会话新建/切换/重命名/克隆/分叉、模型与思考级别、文本与图片提示、Slash Command、Prompt、Skill、Extension 及其交互界面、steer/follow-up 队列、停止与自动重试、上下文统计与压缩、工具活动、会话树、HTML 导出和本地命令终端。
- 交互式 Pi Runtime 拥有自己的会话和事件流；Workflow、AgentTask、Worker 与 Coordinator 使用隔离的 Pi Runtime 实例，不能把后台执行事件写进当前交互会话。
- 从 Pi 对话创建 Task、把 Task 结果带回 Pi，或打开某次 AgentTask 会话，都必须是用户可见的显式动作，并保留原始对象身份。
- Task 控制台初始化或数据错误必须显式展示；只要内置 Pi Runtime 可以启动，就不能因此静默改变 Pi 命令语义或取消 Pi 工作台入口。
- Stella 继续使用官方内置 Pi 包和 RPC 协议，不通过维护一个裁剪版 Pi fork 来换取任务编排能力。

## 影响

Pi 工作台与任务控制台可以共享应用外壳、项目选择、视觉皮肤和内置 Pi Runtime 实现，但分别拥有界面状态与运行会话。新增 Task Room 时应复用 Task/AgentTask 的持久状态并通过显式链接连接 Pi，而不是把现有 Chat 页面改造成只能服务正式任务的页面。

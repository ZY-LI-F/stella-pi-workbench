# Ticket 02 · Task Comment、AgentTaskQueue 与手动 Agent 分发

Status: DONE  
Blocked by: Ticket 01

## Outcome

用户能把任务指派给单个内置 Agent，看到真实持久队列、Pi 输出和评论；Runner 严格串行并保护终态。

## Checklist

- [x] BoardService 支持执行目标、TaskComment CRUD 命令和直接 Agent 分发路由。
- [x] 实现 AgentTaskService：原子入队、认领、结算、中断、任务状态映射和活动记录。
- [x] 实现 AgentTaskRunner，使用注入的 Pi Runtime Factory 和 Agent 快照。
- [x] 成功时保存 session/output/stats 并生成 Agent 评论；失败时保存原始错误。
- [x] Pi 迟到事件必须校验 runtimeToken；abort 终态不能被覆盖。
- [x] typed preload / IPC 暴露评论、分发和 AgentTask 中止命令并验证输入。
- [x] Task Editor 可选择 Workflow 或单 Agent；卡片/详情显示对应执行目标。
- [x] Task Detail 提供评论输入、AgentTask 轨迹、产物与中止操作。
- [x] 添加 service、runner、IPC/renderer 行为测试。
- [x] 运行 typecheck 与相关单测。

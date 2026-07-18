# Ticket 01 · 运行终态、单实例与存储迁移基线

Status: DONE  
Blocked by: none

## Outcome

旧看板可无损迁移到 schema v2；Stella 同一用户数据目录只允许一个桌面实例；重启/关闭不会留下虚假的运行中 AgentTask，并为后续队列实体提供严格验证基础。

## Checklist

- [x] 在共享领域模型中加入 schema v2 新实体、状态常量、执行目标和完整验证。
- [x] 为 legacy schema v1 提供一次性纯迁移，保留 Task / Workflow Run / Activity。
- [x] BoardStore 在替换 v1 前创建时间戳备份；迁移失败不覆盖原文件。
- [x] 启动恢复把 `running` AgentTask 改为 `interrupted`，保留 `queued` 与 `waiting_children`。
- [x] Electron 启动前获取 single-instance lock，第二实例只聚焦第一实例。
- [x] 关闭路径先持久化中断，再停止 Runtime。
- [x] 添加 parser、迁移、备份、恢复和终态单元测试。
- [x] 运行 typecheck 与相关单测。

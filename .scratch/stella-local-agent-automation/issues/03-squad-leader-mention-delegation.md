# Ticket 03 · Squad Leader 与 @mention 动态委派闭环

Status: DONE  
Blocked by: Ticket 02

## Outcome

用户可固化一个 Leader + members Squad；Leader 与用户评论中的有效 @mention 会创建真实子 AgentTask，父任务等待并汇总子结果。

## Checklist

- [x] 实现 Squad 创建、更新、删除验证，禁止 Leader/成员缺失或重复。
- [x] 实现无歧义 mention 解析，支持 Agent id 与 callsign，保留首次出现顺序。
- [x] 用户评论先完整验证 mentions，再原子保存评论与队列项。
- [x] Squad Leader prompt 包含任务、验收、评论、成员清单和委派协议。
- [x] Leader 结算时生成去重子 AgentTask 并进入 `waiting_children`。
- [x] 所有子成功后父成功；任一子失败/中断/取消后父失败并记录摘要。
- [x] Automation Studio 提供 Squad 列表和编辑表单；Task Editor 可选择 Squad。
- [x] Task Detail 以父子轨道显示 Leader、成员与委派来源。
- [x] 添加 mention、父子状态机和 UI 测试。
- [x] 运行 typecheck 与相关单测。

# 07 — 从持久 Execution 快照生成只读可视化 DAG

**What to build:** Workflow Task 在详情中显示由持久定义与 Step Run 派生的可视化 DAG，节点状态、依赖、Agent、目标、Artifact 和错误与时间线使用同一事实源，不引入新的执行引擎。

**Blocked by:** 04 — 分离 Execution Report、Acceptance 与 Task Stage。

**Status:** DONE

- [x] DAG nodes/edges 只由 Workflow snapshot 与 Step Run 派生。
- [x] pending/running/waiting/succeeded/failed/interrupted 状态可辨识。
- [x] 选择节点可查看 Agent、目标、Artifact、错误和 session link。
- [x] 无 Workflow、空步骤和历史 Run 有明确空状态。
- [x] 三套皮肤、键盘操作和窄窗口布局完整。
- [x] DAG projection 和 renderer 测试通过。

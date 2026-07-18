# 05 — 将 Task Detail 升级为 Task Room 时间线投影

**What to build:** 用户在一个 Task Detail 时间线中按时间看到目标、评论、委派、状态回执、执行结果、产物和验收决定；时间线完全来自现有 Task 事实，不创建第二套消息数据库或独立 TaskRoom 实体。

**Blocked by:** 04 — 分离 Execution Report、Acceptance 与 Task Stage。

**Status:** DONE

- [x] 构建纯派生 timeline projection，具有稳定排序和来源标识。
- [x] 用户消息、Agent 输出、系统回执、Artifact 与 review 决定视觉区分。
- [x] 每个执行条目保留 Run/Step/AgentTask 稳定链接。
- [x] reported 条目提供接受、请求修订、拒绝控件。
- [x] 用户 mention 的执行副作用在提交前可见。
- [x] 三套皮肤、键盘焦点、窄窗口与 reduced motion 状态完整。
- [x] projection 与 renderer 行为测试通过。

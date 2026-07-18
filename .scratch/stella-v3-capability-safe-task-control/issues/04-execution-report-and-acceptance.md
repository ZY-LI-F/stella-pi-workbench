# 04 — 分离 Execution Report、Acceptance 与 Task Stage

**What to build:** Agent 或 Workflow 正常返回只生成 reported 结果；用户可明确接受、请求修订或拒绝，所有决定带评论和审计，任何执行状态变化都不会偷偷移动 Kanban 业务阶段。

**Blocked by:** 01 — 建立 Board v3 真状态与无损迁移基线。

**Status:** DONE

- [x] dispatch、claim、settle、fail、interrupt 不自动改变 Task stage。
- [x] 根 AgentTask 和 Workflow Run 正常交付后显示 reported/pending。
- [x] 新增 accept、revision-requested、reject 命令与严格状态校验。
- [x] revision/reject 必须包含非空理由，决定生成 TaskMessage 与 Activity。
- [x] failed/interrupted/cancelled execution 不能被接受。
- [x] late callback 与重复 review 不可改写已持久化事实。
- [x] Task Card/Detail 同时显示业务 stage、执行状态和 acceptance。
- [x] service、IPC、renderer 与 false-success 测试通过。

验证：`npm run check`，17 个测试文件、72 个测试全部通过。

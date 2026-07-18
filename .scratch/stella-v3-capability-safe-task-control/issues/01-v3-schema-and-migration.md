# 01 — 建立 Board v3 真状态与无损迁移基线

**What to build:** 用户升级 Stella 后，现有 schema v2 的 Task、Run、Comment、AgentTask、Squad 与 Autopilot 历史被备份并无损迁移到 v3；Task 业务阶段、执行生命周期、验收状态和 Pi 来源链接有无歧义的持久结构，现有看板仍可完整浏览和操作。

**Blocked by:** None — can start immediately.

**Status:** DONE

- [x] v3 成为唯一写入版本，v2 只作为迁移输入。
- [x] v2 的所有集合、时间戳、session path、runtime token 和错误信息无损保留。
- [x] v2 Task runtime-like status 按 Spec 映射为固定业务 stage。
- [x] 根 Workflow Run 与根 AgentTask 获得独立 acceptance 状态，已有成功记录迁移为 reported/pending。
- [x] 迁移前创建时间戳备份，失败不覆盖原文件。
- [x] parser、migration、backup 与 UI bootstrap 测试通过。

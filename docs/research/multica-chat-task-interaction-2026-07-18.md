# Multica Chat → Task 交互源码审计与 Stella Chat-first 方案

> 审计日期：2026-07-18（Asia/Shanghai）
> Multica 固定提交：002ea0d87949d112d96586bd8b42c779142cf77d
> Stella 固定提交：1cb25fd1b6124f8c661c046f77a3a262caa495a3
> 证据范围：仅使用 Multica 官方仓库当前源码、迁移、SQL、测试语义和官方文档，以及 Stella 当前源码
> 结论口径：当前运行代码、数据库写入和 API 链路优先于 README、产品文案与历史计划

## 1. 结论先行

用户提出的直觉是正确的：**Stella 应当允许用户从 Chatbot 开启任务。**

但 Multica 源码给出的答案并不是“Chat 或 Kanban 二选一”，而是把“任务”拆成了两个不同对象：

| 中文语境里的“任务” | Multica 实体 | 用途 | 是否出现在 Kanban |
|---|---|---|---|
| 一次 Agent 执行 | AgentTask / agent_task_queue | 排队、领取、调用 Agent CLI、取消、完成、失败 | 不一定 |
| 一个正式工作项 | Issue | 标题、描述、负责人、项目、状态、评论、审计与自动化 | 是 |

普通 Direct Chat **每发送一条消息，已经会启动一次真实 AgentTask**；只是该任务的 issue_id 被明确写为 NULL，所以不会自动产生看板卡。[chat.sql L199-L231](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/pkg/db/queries/chat.sql#L199-L231)

Multica 同时提供了两条显式“聊天语言 → 正式 Issue”路径：

1. Web 端的 **Quick Create / Agent mode**：用户用自然语言描述工作，选择 Agent 或 Squad、Project、优先级等，后台 Agent 被约束为恰好执行一次 issue create。
2. Slack / Lark 中的 **/issue 命令**：明确标记创建意图，服务端确定性解析首行标题和后续描述，直接创建 Issue。

因此，最准确的产品结论是：

> Chat 是低仪式感的意图入口与执行对话层；Kanban 是正式工作的控制层；AgentTaskQueue 是统一运行层；“固化为任务”是 Chat 到 Kanban 的显式提交边界。

对 Stella 最合适的升级不是复制 Multica 的所有 Chat 基础设施，也不是让每句聊天都自动建卡，而是：

- 保留当前 Pi 对话和现有 Kanban；
- 在 Composer 加入明确的“对话 / 创建任务 / 运行流程”意图；
- 让 Agent 生成类型化 TaskDraft；
- 在 Chat 中展示可编辑确认卡；
- 用户点击“仅创建”或“创建并启动”后，复用现有 BoardService 和 AgentTaskService；
- 创建成功后在 Chat 中嵌入同一张 Kanban Task 的实时回执。

## 2. 审计问题与证据分级

本报告回答以下问题：

1. Multica 是否真的通过 Chatbot 开启任务？
2. Chat Composer、会话、消息 API、PostgreSQL 队列和本地 Daemon 如何串起来？
3. Chat、Issue、Project、Workspace 的创建入口是否统一？
4. Agent、Squad 与 @mention 在 Chat 中到底是引用还是动态委派？
5. Chat 创建的执行与 Kanban 有什么真实数据关系？
6. 哪些能力已实现，哪些只是 UI 暗示、文档漂移或计划？
7. Stella 当前为何呈现“Chat 和看板分开”，怎样以最小复杂度改成 Chat-first？

证据标签：

- **[已实现]**：前端入口、API、服务、持久化和运行路径能够闭环。
- **[部分实现]**：存在真实路径，但没有形成用户以为的完整语义。
- **[UI 歧义]**：界面允许或暗示某动作，后端并没有对应执行语义。
- **[文档漂移]**：官方文档与固定提交的当前运行代码冲突。
- **[计划]**：只存在设计文档、注释或未来占位，没有当前运行闭环。
- **[建议]**：本报告基于源码事实提出的 Stella 方案，不声称 Multica 已实现。

## 3. Multica 不是“不通过 Chat 开任务”，而是区分 AgentTask 与 Issue

Multica 官方任务文档也明确将 Task 定义为“一次 Agent run”，而不是看板 Issue；Issue 分配、评论 mention、Direct Chat 和 Autopilot 都可以产生 Task。[tasks.zh.mdx L9-L32](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/apps/docs/content/docs/tasks.zh.mdx#L9-L32)

这个区分解释了表面上的矛盾：

- 用户在 Chat 里发送“分析这个方案”，系统确实创建后台任务并调用 Agent。
- 但系统不会因此自动创建标题、负责人、项目、状态、验收标准齐全的 Issue。
- 同一段对话可以触发多次 AgentTask，却仍然只是一段私密 Chat。
- 一个正式 Issue 也可以先后触发多次 AgentTask，例如首次指派、评论 mention、Squad Leader 和成员子任务。

数据库迁移专门将 agent_task_queue.issue_id 改成可空，目的就是让 Chat task 不依赖 Issue。[033_chat.up.sql L32-L36](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/migrations/033_chat.up.sql#L32-L36)

这不是“前端遗漏了建卡按钮”能够完整解释的，而是当前领域模型中的明确边界。

## 4. Multica 实际存在三条自然语言入口

### 4.1 路径一：Direct Chat

Direct Chat 是用户和一个固定 Agent 的私密、持久、可恢复对话。每条消息创建一个 issue_id 为空的 AgentTask，进入 PostgreSQL 队列，由本地 Daemon 调用 Agent CLI。

    用户消息
        ↓
    ChatSession + ChatMessage
        ↓
    AgentTask（issue_id = NULL）
        ↓
    PostgreSQL agent_task_queue
        ↓
    Local Daemon claim
        ↓
    Agent CLI / provider session
        ↓
    AssistantMessage + 实时状态

这是“Chat 开启执行任务”，不是“Chat 自动创建 Kanban Issue”。

### 4.2 路径二：Web Quick Create / Agent mode

Quick Create 是独立的自然语言建卡入口：

    一段自然语言描述
        + Agent 或 Squad
        + Project / Priority / Due / Parent / Attachments
        ↓
    POST /api/issues/quick-create
        ↓
    QuickCreate AgentTask
        ↓
    Daemon 运行受限 Prompt
        ↓
    恰好一次 multica issue create
        ↓
    Formal Issue + Inbox 通知

它已经实现“通过 Agent 将自然语言转成正式 Issue”，但它是一个单轮 Modal，不是普通 Chat 中的多轮澄清和确认。

### 4.3 路径三：Slack / Lark 的 /issue

外部聊天频道使用显式命令区分普通聊天与建卡：

    /issue 修复登录超时
    复现条件……
        ↓
    解析首行标题 + 后续描述
        ↓
    IssueService.Create
        ↓
    Issue / Kanban

共享引擎只在第一条非空行精确识别 /issue，随后用第一行作为标题、余下正文作为描述。[issue_command.go L5-L58](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/integrations/channel/engine/issue_command.go#L5-L58)

路由层直接调用 IssueService.Create，而不是先让 LLM 自由判断是否应创建卡片；消息仍会保存在 Chat session 中，并继续调度一次 Chat run。[router.go L270-L315](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/integrations/channel/engine/router.go#L270-L315) [router.go L452-L469](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/integrations/channel/engine/router.go#L452-L469)

这条路径表达了一个非常清楚的交互原则：**用显式意图标记保护看板，不让普通聊天静默变成正式工作。**

## 5. Direct Chat 的完整前端交互

### 5.1 Chat 是一级产品入口，不是展示性组件

Chat 页面是完整的双栏会话界面，支持通过 URL 的 session 参数恢复指定会话，也支持 agent 参数预选 Agent。[chat-page.tsx L31-L49](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/chat-page.tsx#L31-L49)

Multica 还有非 Chat 路由可用的全局 Floating Chat；最小化后的 FAB 会响应未读和 pending 状态。[floating-chat.tsx L10-L34](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/floating-chat.tsx#L10-L34) [chat-fab.tsx L23-L53](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/chat-fab.tsx#L23-L53)

### 5.2 一次会话固定绑定一个 Agent

新建 Chat 时先选择一个 Agent；会话创建后，目标 Agent 不随每条消息改变。控制器按“当前 session Agent → 用户偏好 → 首个可用 Agent”解析目标。[use-chat-controller.ts L255-L304](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/use-chat-controller.ts#L255-L304)

Chat session 不在用户只是打开空窗口时创建，而是在第一次发送时懒创建，参数中保存固定 agent_id。[use-chat-controller.ts L342-L375](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/use-chat-controller.ts#L342-L375)

服务端创建会话时验证 workspace、Agent、查看和 invoke 权限，并保存 creator。[chat.go L33-L123](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/handler/chat.go#L33-L123)

因此 Multica 当前的 Direct Chat 模型是：

> 用户 ↔ 一个固定 Agent 的私密、连续会话。

它不是多 Agent 群聊，也不是每一轮自由选择 Squad 的任务路由器。

### 5.3 Composer 已覆盖真实聊天所需交互

Composer 在提交前检查：

- 文本和附件是否同时为空；
- 附件是否仍在上传；
- 当前 AgentTask 是否正在运行；
- 是否重复提交；
- Agent 是否可用；
- 会话是否已归档。

发送失败时恢复草稿，而不是吞掉输入。[chat-input.tsx L372-L478](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/chat-input.tsx#L372-L478)

编辑器支持富文本、附件、mention suggestion、slash command、Submit 和 Stop。[chat-input.tsx L518-L573](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/chat-input.tsx#L518-L573)

控制器发送时先乐观插入用户消息和 queued task；API 失败则回滚临时数据并恢复草稿；成功后用服务端真实 message_id 和 task_id 替换临时 ID。[use-chat-controller.ts L450-L603](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/use-chat-controller.ts#L450-L603)

### 5.4 当前空状态没有“任务 starter”

Chat 的空状态只展示当前 Agent 身份，没有“创建任务”“拆分需求”“运行 Squad”等可选 starter。[chat-empty-state.tsx L7-L38](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/chat-empty-state.tsx#L7-L38)

Chat 的加号菜单注释为将来可容纳 Agents、Skills、Tools，但当前实际菜单只有文件上传。[chat-add-menu.tsx L21-L61](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/chat-add-menu.tsx#L21-L61)

因此“Chat 是完整执行入口”已经实现，但“在 Chat 中显式创建正式任务的丰富动作菜单”尚未实现。

## 6. 从一条消息到 PostgreSQL AgentTaskQueue

### 6.1 API

前端调用 POST /api/chat/sessions/{sessionId}/messages，响应包含 message_id、task_id 和 created_at。[client.ts L1998-L2050](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/core/api/client.ts#L1998-L2050)

服务端验证：

- 当前用户和 workspace；
- session 是否 active；
- Agent 是否归档；
- Agent runtime 是否可用；
- 用户是否具备 invoke 权限；
- 附件是否属于同一 workspace。

验证后调用 SendDirectChatMessage，并返回真实消息与任务 ID。[chat.go L605-L760](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/handler/chat.go#L605-L760)

### 6.2 原子事务

SendDirectChatMessage 在同一个事务中：

1. 创建 Chat AgentTask；
2. 将本轮输入绑定到唯一 task owner；
3. 创建用户消息；
4. 绑定附件；
5. touch Chat session；
6. commit 后才广播 queued 并唤醒 Daemon。

[task.go L1483-L1595](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/service/task.go#L1483-L1595)

这保证不会出现“界面显示消息已发送，但任务没有入队”的半成功状态。

### 6.3 ChatTask 的关键字段

创建 ChatTask 的 SQL 明确写入：

- chat_session_id；
- status = queued；
- priority = medium；
- issue_id = NULL；
- chat_input_task_id 指向自身，形成不可混淆的输入所有权。

[chat.sql L199-L254](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/pkg/db/queries/chat.sql#L199-L254)

Pending task 也从数据库恢复，不只存在于浏览器内存中。[chat.sql L256-L265](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/pkg/db/queries/chat.sql#L256-L265)

### 6.4 同一会话串行

任务 claim 使用 FOR UPDATE SKIP LOCKED，并避免同一 Issue、同一 Agent 或同一 chat_session 的执行互相踩踏。[agent.sql L445-L483](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/pkg/db/queries/agent.sql#L445-L483)

这让“持续聊天”具备稳定的顺序语义，而不是只靠前端禁用按钮。

## 7. Daemon 如何调用 Agent CLI

### 7.1 Claim 时提供精确 Chat 上下文

Daemon claim handler 会加载 Chat session、workspace、provider resume pointer、本轮唯一拥有的消息批次和附件；缺失或损坏输入时显式失败。[handler/daemon.go L2022-L2189](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/handler/daemon.go#L2022-L2189)

随后服务端为本次 task 签发 task-scoped token，并返回运行所需上下文。[handler/daemon.go L2411-L2550](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/handler/daemon.go#L2411-L2550)

### 7.2 运行

Daemon 运行时会：

- 建立隔离工作目录；
- 选择 Agent provider/runtime；
- 构造 Chat 专用 Prompt；
- 注入 MULTICA_TOKEN、workspace、agent、task 等环境；
- 创建 Agent CLI adapter；
- 尝试恢复 provider session；
- 将实时事件持续回传；
- 在恢复失败且尚未建立新 session 时显式重跑一个 fresh session。

[daemon.go L3815-L3935](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/daemon/daemon.go#L3815-L3935) [daemon.go L4101-L4453](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/daemon/daemon.go#L4101-L4453)

Chat 有独立 Prompt 组装路径，不是把 Issue 评论 Prompt 改个标题复用。[prompt.go L305-L419](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/daemon/prompt.go#L305-L419)

### 7.3 完成、失败与 resume pointer

任务成功时，服务层在同一个事务里：

- 将 AgentTask 置为 completed；
- 更新 Chat session 的 provider session ID、workdir 和 runtime；
- 写入一条 assistant message；
- 处理 attachment-only 和 no-response 情况。

[task.go L2573-L2855](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/service/task.go#L2573-L2855)

失败也会落一条用户可见的 assistant failure message，并保留安全的 resume 语义，不只写后台日志。[task.go L2891-L3108](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/service/task.go#L2891-L3108)

## 8. Chat 的状态反馈为什么值得借鉴

Multica 将内部 Task 生命周期翻译为用户能理解的 Chat 状态：

- queued；
- Agent offline；
- reconnecting / runtime unstable；
- waiting local directory；
- starting；
- thinking；
- typing；
- 正在调用具体工具。

[task-status-pill.tsx L25-L109](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/task-status-pill.tsx#L25-L109)

计时以服务端 created_at 为锚点，所以刷新后不会重新从零开始；组件还使用 live region 暴露状态。[task-status-pill.tsx L131-L180](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/task-status-pill.tsx#L131-L180)

消息列表同时展示：

- 已持久化消息；
- 当前实时 timeline；
- pending task；
- tool execution；
- no_response；
- elapsed time；
- failure detail；
- attachment；
- copy action。

[chat-message-list.tsx L140-L231](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/chat-message-list.tsx#L140-L231) [chat-message-list.tsx L350-L519](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/chat-message-list.tsx#L350-L519)

实时同步层处理 chat:message、chat:done，以及 queued、dispatch、running、waiting、cancelled、completed、failed 等事件。[use-realtime-sync.ts L1055-L1151](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/core/realtime/use-realtime-sync.ts#L1055-L1151) [use-realtime-sync.ts L1171-L1310](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/core/realtime/use-realtime-sync.ts#L1171-L1310)

这意味着 Chat-first 不是只加一个输入框。完整交互至少要覆盖：

- durable pending；
- Stop / Cancel；
- queued、offline、waiting、running 的区别；
- 工具执行进度；
- 明确 failure；
- 刷新恢复；
- CLI session continuation。

## 9. Quick Create：已实现的自然语言正式建卡

### 9.1 Manual 与 Agent 两种模式

同一个 Create Issue Dialog 在 manual 和 agent 两种 body 间切换。[create-issue-dialog.tsx L13-L95](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/modals/create-issue-dialog.tsx#L13-L95)

AgentCreatePanel 可选择：

- Agent 或 Squad；
- Project；
- Priority；
- Due date；
- Parent issue；
- Attachments；
- 一段富文本自然语言 Prompt。

Squad 只有存在可见 Leader 时才可选；选 Squad 后由 Leader 承接 Quick Create 协议。[quick-create-issue.tsx L121-L229](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/modals/quick-create-issue.tsx#L121-L229) [quick-create-issue.tsx L510-L565](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/modals/quick-create-issue.tsx#L510-L565)

提交 payload 要求 Agent 和 Squad 恰好选一个，并允许 keep-open 连续创建。[quick-create-issue.tsx L302-L387](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/modals/quick-create-issue.tsx#L302-L387)

### 9.2 后端校验和异步返回

前端调用 POST /api/issues/quick-create，返回 task_id。[client.ts L721-L735](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/core/api/client.ts#L721-L735)

后端校验 Agent/Squad 二选一、Squad Leader、invoke 权限、runtime 在线和版本、Project、Parent、附件与 workspace 一致性，然后返回 202 Accepted。[issue.go L2023-L2257](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/handler/issue.go#L2023-L2257)

QuickCreateContext 在入队时还没有 issue_id 或 chat_session_id，任务完成后才通过 origin 精确找到所创建的 Issue 并 LinkTaskToIssue，然后给请求者发 Inbox 成功通知。[task.go L1232-L1380](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/service/task.go#L1232-L1380) [task.go L4261-L4377](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/service/task.go#L4261-L4377)

### 9.3 运行契约

Quick Create Prompt 要求 Agent：

- 将自然语言忠实转换为结构化 Issue；
- 解析标题、描述、assignee、Squad、Project、Due、Parent、Status；
- 恰好执行一次 multica issue create；
- 命令失败后不得用第二次创建“重试”。

[prompt.go L45-L146](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/daemon/prompt.go#L45-L146)

Runtime brief 只为 Quick Create 列出最小 issue create 命令，并再次写明 exactly one invocation。[runtime_config_sections.go L216-L225](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/daemon/execenv/runtime_config_sections.go#L216-L225) [runtime_config_sections.go L337-L345](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/daemon/execenv/runtime_config_sections.go#L337-L345)

### 9.4 当前没有创建前结构化确认

固定提交中没有发现“Agent 先生成 TaskDraft，用户二次确认后才创建”的闭环。用户点击 Quick Create 后，服务端直接返回 202 并后台建卡。

所以本报告后文建议的“结构化预览确认卡”是对 Multica 的交互改进，不应误写成其已有功能。

## 10. Chat、@mention、Agent 和 Squad 的真实语义

### 10.1 Direct Chat 的 Agent 是 session 级目标

Direct Chat 开始时选 Agent，之后消息始终路由到 session 已绑定的同一个 Agent。普通发送 API 没有每轮 agent_id 或 squad_id。

因此：

- 选择 Chat Agent：是真实路由。
- 在新消息中写另一个 @Agent：不会自动切换 session Agent。
- 在消息中写 @Squad：不会自动产生 Squad Leader task。

### 10.2 Chat 编辑器确实可能显示 Agent/Squad suggestion

ChatInput 未收到 contextItems 时使用 default mention mode。[chat-input.tsx L518-L543](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/chat/components/chat-input.tsx#L518-L543)

通用 mention suggestion 的 default 搜索包含 members、agents、squads 和 issues。[mention-suggestion.tsx L528-L626](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/packages/views/editor/extensions/mention-suggestion.tsx#L528-L626)

但 SendChatMessage 后端只接收 content 与 attachments，然后为 session 固定 Agent 入队；没有调用 Issue comment 的 mention resolver。[chat.go L684-L760](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/handler/chat.go#L684-L760)

所以这是 **[UI 歧义]**：

> Chat 中的 @Agent/@Squad 至多是传给当前 Agent 的富文本引用，不是服务端动态委派。

### 10.3 Issue 评论中的 mention 才是真委派

Issue comment handler 会解析 Agent/Squad mention，并调用独立入队逻辑。[comment.go L2213-L2242](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/handler/comment.go#L2213-L2242)

官方 Squad 模型也是：

1. Issue 分配给 Squad；
2. 创建 Leader task；
3. Leader 阅读共享 Issue 上下文；
4. Leader 在 Issue 评论里 @成员；
5. 成员分别获得 AgentTask；
6. 结果回到同一 Issue thread。

[squads.zh.mdx L59-L101](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/apps/docs/content/docs/squads.zh.mdx#L59-L101)

因此 Multica 把 Squad 协作放在可审计的正式 Issue thread，而不是私人多 Agent 群聊中。

### 10.4 Stella 应避免复刻这项歧义

建议把相似的视觉交互拆成不同语义：

| 用户动作 | 语义 | 是否创建 AgentTask |
|---|---|---|
| 引用 Issue / Project | 给当前 Agent 添加上下文 | 否，仍由当前消息触发一个 Chat run |
| 选择“执行者：@Agent” | TaskDraft 的 executionTarget | 确认创建并启动后是 |
| 在正式 Task 评论中 @Agent | 追加一次真实委派 | 是 |
| 在正式 Task 评论中 @Squad | 启动 Leader 分派 | 是 |
| 普通 Chat 文本里出现 @名称 | 默认只视为文本/上下文 | 不额外创建 |

## 11. Chat 与 Kanban 的真实关联

### 11.1 普通 Chat 默认不绑定 Issue

普通 Chat 的 AgentTask 保持 issue_id = NULL。Chat UI 也没有内嵌的“已创建正式任务卡”实体。

### 11.2 当前 Chat Agent 可以按请求调用 CLI 创建 Issue

这里存在重要的 **[文档漂移]**。

官方 Chat 中文文档声称 Chat 完全沙盒，Agent 看不到或修改不了 Issue，issue list 会返回空。[chat.zh.mdx L3-L40](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/apps/docs/content/docs/chat.zh.mdx#L3-L40)

但当前 runtime brief 明确写出：

- Chat 获得 full Available Commands；
- 可以使用完整 multica CLI；
- 可以 issue list / get；
- 被要求执行动作时可以 create issue、update status；
- 需要改代码时可以 repo checkout。

[runtime_config_sections.go L185-L214](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/daemon/execenv/runtime_config_sections.go#L185-L214) [runtime_config_sections.go L325-L345](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/daemon/execenv/runtime_config_sections.go#L325-L345)

Section × Kind matrix 也明确显示 Chat 使用 full commands、repositories 与 skills，只跳过 project context、issue metadata、subissue、mentions 和 attachments 等 Issue 专属提示段。[runtime_config_sections.go L559-L578](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/daemon/execenv/runtime_config_sections.go#L559-L578)

因此在固定提交中，运行代码才是事实来源：**Chat Agent 被设计为可在用户权限范围内按请求查找和操作 Issue。**

但这仍不等于每条 Chat 自动建卡；是否调用 issue create 由当前 Agent 对自然语言的理解决定，没有 Quick Create 的专用模式和精确确认边界。

### 11.3 Chat Agent 创建的 Issue 有 provenance，但没有强 UI 连接

Agent 通过 task-scoped token 创建 Issue 时，handler 会把 origin_type 标记为 agent_create，并把 origin_id 记录为当前 AgentTask ID。[issue.go L2496-L2547](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/handler/issue.go#L2496-L2547)

Issue 创建后通过正常 issue:created 事件进入列表/Kanban。[issue.go L2576-L2611](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/internal/handler/issue.go#L2576-L2611)

但原 Chat AgentTask 的 issue_id 仍为 NULL；当前 Chat UI 没有把这个 provenance 自动渲染成一个持续同步的 Issue Card。

所以关系是：

    Chat message
        ↓
    Chat AgentTask（issue_id = NULL）
        ↓ Agent 自主调用 issue create
    Issue（origin_type = agent_create, origin_id = Chat AgentTask ID）
        ↓
    Kanban

Quick Create 的关联更强：完成处理会显式 LinkTaskToIssue。

## 12. Workspace、Project、Issue 与 Task 创建入口并没有统一

| 对象 | 当前一等入口 | Chat 特定入口 | 结论 |
|---|---|---|---|
| ChatSession | Chat 页面 / Floating Chat | 首次发送懒创建 | 完整实现 |
| AgentTask | Issue、mention、Chat、Autopilot 等 | 每条 Chat 消息创建 | 完整实现 |
| Issue | 表单、Quick Create、API、/issue | Agent 可按请求调用 CLI 创建 | 多路径实现 |
| Project | Project UI / API / CLI | 无 Chat 专用、无确认式流程 | 可被 full CLI 发现，但不是设计好的 Chat 交互 |
| Workspace | Onboarding / Workspace UI / API / CLI | 无 Chat 专用、无确认式流程 | 同上 |

Multica CLI 确实包含 workspace create 和 project create。[cmd_workspace.go L16-L120](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/cmd/multica/cmd_workspace.go#L16-L120) [cmd_project.go L16-L141](https://github.com/multica-ai/multica/blob/002ea0d87949d112d96586bd8b42c779142cf77d/server/cmd/multica/cmd_project.go#L16-L141)

由于 Chat runtime 声明 full CLI，Agent 理论上可以通过 help 发现这些命令；但当前没有类似 Quick Create Issue 的专用 typed payload、权限预检、结构化预览或成功回执。因此不应把“CLI 可发现”宣传成“已完成 Chatbot 创建 Workspace/Project 的产品交互”。

## 13. 官方文档、运行代码与计划的漂移

| 主题 | 文档或 UI 表述 | 固定提交运行事实 | 判定 |
|---|---|---|---|
| Chat 看不到 Issue | chat.zh 明确说完全沙盒 | runtime brief 明确允许 list/get/create/update | 文档漂移 |
| Chat 中不能 @Agent/Squad | 文档这样写 | UI default suggestion 可能展示；后端不委派 | 文档在执行语义上正确，UI 有歧义 |
| Slack 自然语言由 Agent 结构化 Issue | Slack 文档倾向这样描述 | engine 直接解析首行/正文并 IssueService.Create | 文档过度概括 |
| Quick Create | 自然语言建卡 | 前后端、队列、Daemon、origin、Inbox 完整 | 已实现 |
| Chat 加号菜单 Agents/Skills/Tools | 注释预留未来动作 | 当前只有上传文件 | 计划/占位 |
| AI 创建 Agent / Skill Finder | docs/agent-quick-create-plan.md 三阶段计划 | 当前计划文件明确列为 Phase 2/3 新 endpoint、新 CLI、新 UI | 计划，不是已实现 |
| Chat 创建前 TaskDraft 确认 | 未见官方承诺 | 当前 Quick Create 直接 202 | 未发现实现 |
| Chat 多 Agent 群聊 | 无一等模型 | session 固定单 Agent | 未实现 |

这张表也说明：审查 Multica 不能只读 README 或 docs，必须以当前 runtime brief、handler、service、SQL 与前端调用共同定论。

## 14. 当前 Stella 的真实交互与缺口

### 14.1 Chat 与 Kanban 是两条独立 UI 路径

Stella 当前 App 同时初始化 usePiRuntime 与 useKanban，但默认 workspaceView 是 kanban。[App.tsx L123-L140](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/App.tsx#L123-L140)

newSession 会发送 Pi 的 new_session 并切到 Chat；newTask 则切到 Kanban 并打开 Task Editor。[App.tsx L154-L172](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/App.tsx#L154-L172)

Chat Composer 提交直接调用 Pi prompt；它没有 Task intent、TaskDraft 或 BoardService bridge。[App.tsx L208-L214](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/App.tsx#L208-L214)

渲染层也是二选一：Chat 渲染 Conversation + Composer，Kanban 渲染 KanbanWorkspace。[App.tsx L344-L394](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/App.tsx#L344-L394)

因此源码只能证明“当前两条路径没有桥”；它没有证明“产品上不应该从 Chat 创建任务”。

### 14.2 当前 Composer 只有 Pi 对话语义

Composer 的核心 contract 是 onSend(message, images)，slash suggestion 来源也是 Pi command；submit 最终只调用 onSend。[Composer.tsx L21-L34](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/components/Composer.tsx#L21-L34) [Composer.tsx L77-L116](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/components/Composer.tsx#L77-L116)

这里缺少：

- composer intent；
- task target；
- typed draft；
- confirmation card；
- create-only / create-and-run；
- task receipt；
- task status subscription。

### 14.3 看板本身已有可复用的正式创建 contract

TaskEditorDialog 已收集：

- title；
- description；
- acceptanceCriteria；
- priority；
- executionTarget（Agent / Squad / Workflow）。

[TaskEditorDialog.tsx L42-L80](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/features/kanban/TaskEditorDialog.tsx#L42-L80) [TaskEditorDialog.tsx L88-L171](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/features/kanban/TaskEditorDialog.tsx#L88-L171)

Kanban controller 已分开暴露 createTask 与 dispatchTask，并映射到 boardCreateTask / boardDispatchTask。[use-kanban.ts L81-L98](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/hooks/use-kanban.ts#L81-L98) [use-kanban.ts L136-L169](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/renderer/src/hooks/use-kanban.ts#L136-L169)

共享模型已经定义 CreateTaskInput、ExecutionTarget、KanbanTask 和 AgentTask。[kanban.ts L100-L121](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/shared/kanban.ts#L100-L121) [kanban.ts L194-L216](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/shared/kanban.ts#L194-L216) [kanban.ts L324-L342](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/shared/kanban.ts#L324-L342)

这意味着 Chat-first 不需要另造一种 Kanban Task，只要让 Chat 产出同一个 CreateTaskInput。

### 14.4 当前执行队列与 Runner 也可复用

AgentTaskService 已支持：

- Task 评论 @mention 创建真实 AgentTask；
- direct 与 Squad Leader dispatch；
- claimNext；
- completion；
- Leader 输出中的 @mention 动态生成成员子任务。

[agent-task-service.ts L71-L190](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/agent-task-service.ts#L71-L190) [agent-task-service.ts L241-L330](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/agent-task-service.ts#L241-L330)

AgentTaskRunner claim 后创建 Pi RPC runtime、流式消费事件并 complete/fail。[agent-task-runner.ts L104-L229](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/agent-task-runner.ts#L104-L229)

所以不能再为 Chat 创建正式 Task 引入第二套执行队列。正确路径是：

    Chat TaskDraft
        ↓
    existing BoardService.createTask
        ↓ 可选
    existing AgentTaskService / WorkflowOrchestrator
        ↓
    existing AgentTaskRunner

### 14.5 一个必须诚实记录的当前实现事实

在 Stella 固定提交 1cb25fd 中，Board 与 AgentTask 目前持久化在用户目录的 board/board.json，并通过临时文件写入后 rename；并不是 PostgreSQL。[board-store.ts L24-L117](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/board-store.ts#L24-L117) [board-store.ts L133-L173](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/board-store.ts#L133-L173) [index.ts L759-L808](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/index.ts#L759-L808)

这与之前讨论的“PostgreSQL AgentTaskQueue”目标不同。交互方案不应假装当前已有 PostgreSQL；本轮建议仍只依赖 BoardRepository contract，以便未来替换持久层而不改 Chat 交互。

## 15. 为什么当前没有从 Chat 创建 Task

从源码能确认的直接原因只有：

1. App 用 workspaceView 将 Chat 与 Kanban 条件渲染为两条视图。
2. Composer 的提交 contract 只接受 Pi prompt。
3. newTask 只会打开 Kanban 的 TaskEditorDialog。
4. Board create / dispatch 只在 useKanban 和 KanbanWorkspace 路径中调用。
5. Chat 消息和 Kanban Task 没有 origin 或 receipt 关系。

以下则是基于领域职责的合理产品推断，不应伪装成作者原话：

- Chat 适合探索、提问、澄清和临时执行。
- Kanban Task 需要确定的标题、验收、优先级、状态和执行者。
- 当前 Task 强制要求 executionTarget，普通聊天并没有这个字段。
- 如果每句话都自动建卡，会制造重复和噪声。
- Squad、Schedule、Webhook、DAG 等后续自动化需要稳定的正式对象，而不是尚未澄清的一句话。

所以问题不在“为什么不做 Chatbot”，而在于当前缺少一个明确的 **intent → typed draft → confirm → create** bridge。

## 16. Stella 最小 Chat-first 交互方案

### 16.1 总体原则

保留三个层次：

    Stella Chat
       ├── 对话 → 当前 Pi session，只做对话/临时执行
       ├── 创建任务 → TaskDraft → KanbanTask → 可选 AgentTask
       └── 运行流程 → TaskDraft + Workflow target → WorkflowRun / AgentTasks

Chat 是默认工作入口，Kanban 仍是事实来源；两者展示同一个 Task ID，不复制状态。

### 16.2 Composer 的三种明确意图

建议在输入框左下或输入框上沿放一个轻量 intent selector：

| 模式 | 默认行为 | 必填边界 |
|---|---|---|
| 对话 | 发送给当前 Pi session | 当前 session |
| 创建任务 | 生成 TaskDraft，不立即建卡 | title、executionTarget；其余可编辑 |
| 运行流程 | 生成 TaskDraft，并要求 workflow target | workflow |

快捷命令可同时保留：

- /task
- /workflow
- /schedule
- /webhook

但快捷命令只是效率入口，不能是唯一入口。

普通“对话”模式不应根据模型猜测偷偷建卡。只有用户选择“创建任务”、输入 /task，或点击某条消息的“固化为任务”动作，才进入正式创建流程。

### 16.3 支持从已有对话固化

除了在发送前选择“创建任务”，每条用户消息或一组连续消息都应提供：

- 固化为任务；
- 添加到已有任务；
- 作为验收标准；
- 作为任务评论。

MVP 只需要第一项“固化为任务”。它将选中的消息文本和必要上下文交给 TaskDraft 生成器。

### 16.4 类型化 TaskDraft，而不是解析模型 prose

建议增加不可变 TaskDraft：

| 字段 | 来源 |
|---|---|
| title | Agent 提炼，用户可编辑 |
| description | 原始意图与上下文摘要 |
| acceptanceCriteria | Agent 提取，缺失时明确为空 |
| priority | 用户或 Agent 建议 |
| executionTarget | Agent、Squad 或 Workflow；必须明确 |
| sourceSession | 当前 Pi sessionFile |
| sourceEntryIds | 被固化的消息 ID |

Agent 应通过一个严格 schema 的本地 tool / extension 返回 TaskDraft；不要从自然语言回复或 Markdown 代码块中猜字段。schema 不合法时显示真实错误并允许重试，不要静默退回到“自动创建一个模糊任务”。

TaskDraft 只是临时预览，不进入 AgentTaskQueue。

### 16.5 必须有确认卡

Chat 中插入一张可编辑确认卡：

    我理解你要创建：

    标题：审查登录流程并修复高风险问题
    描述：……
    验收：
      1. 高风险问题有回归测试
      2. 构建与测试通过
      3. 输出变更摘要
    优先级：High
    执行者：Review Squad
    流程：代码审查与修复

    [创建并启动]  [仅创建到待规划]  [继续修改]  [取消]

四个动作语义必须严格：

- **创建并启动**：先 boardCreateTask，成功后再 boardDispatchTask。
- **仅创建到待规划**：只调用 boardCreateTask。
- **继续修改**：保留 draft，允许自然语言或字段编辑。
- **取消**：销毁 draft，不创建任何持久 Task。

如果 create 成功而 dispatch 失败，界面必须显示“Task 已创建，但启动失败”，保留真实 Task Card 和失败原因；不能回滚成“什么都没发生”，也不能显示完整成功。

### 16.6 创建后的 Chat Task Receipt

创建成功后，用持久 TaskReceipt 替换草稿卡：

- Task ID 与标题；
- Kanban status；
- executionTarget；
- active AgentTask / WorkflowRun；
- queued / running / waiting / failed / completed；
- elapsed time；
- 当前 DAG 节点；
- Stop；
- Retry；
- 打开看板；
- 打开详情。

Receipt 只引用现有 Task ID，状态始终从 BoardRepository/AgentTask 状态读取，不复制一套 Chat 私有状态。

### 16.7 Agent / Squad / Workflow 选择

执行目标必须是明确 chip，不应只靠自然语言 @mention：

    执行者  [Stella ▾]
    执行者  [晨曦 Squad ▾]
    流程    [代码审查 DAG ▾]

Agent 可以提出建议，但解析到多个同名对象或没有可用目标时，确认卡应要求用户选择，不要任意取第一个。

当目标是 Squad 时，卡片应明确显示：

    晨曦 Squad
    Leader：晨曦
    成员：……
    委派方式：Leader 输出中的 @mention

当目标是 Workflow 时，可在卡片里用最小节点预览，不必把完整图编辑器塞进 Chat。

### 16.8 普通 Chat 与正式 Task 中的 @ 必须不同

建议固定规则：

- 普通 Chat 的 @Agent：只切换或添加上下文，不创建额外任务。
- TaskDraft 的 @Agent/@Squad：设置 executionTarget，确认后生效。
- 已有 Task 评论里的 @Agent/@Squad：沿用当前真实委派语义。
- 如果以后允许在普通 Chat 中直接委派，必须弹出明确动作选择，不能只依靠相同的 @ 视觉。

### 16.9 默认首页

如果产品希望强化 Chatbot 心智，可以把启动后的默认主区域改成 Chat 或恢复上次视图，同时在空状态给出三个 starter：

- 和 Stella 讨论；
- 创建一个任务；
- 运行一个固定流程。

这不会削弱 Kanban；看板仍在左侧一级导航，并且所有正式 Task 都能从 Receipt 一键打开。

## 17. 完整交互状态机

### 17.1 创建任务

    idle
      ↓ 选择“创建任务”或 /task
    composing
      ↓ send
    drafting
      ├── schema/error → draft_failed（显示原因，可重试）
      └── valid TaskDraft
              ↓
          awaiting_confirmation
              ├── edit → awaiting_confirmation
              ├── cancel → cancelled
              ├── create_only
              │       ↓
              │   creating → created
              └── create_and_run
                      ↓
                  creating
                      ├── create failed → create_failed
                      └── created
                              ↓
                          dispatching
                              ├── failed → created_but_dispatch_failed
                              └── queued → running → terminal

### 17.2 运行中的 Receipt

| 状态 | 用户看到 | 可用动作 |
|---|---|---|
| queued | 已入队、排队位置或等待执行 | Stop、打开看板 |
| waiting | 明确等待本地目录/Daemon/HumanGate | 解决依赖、Stop |
| running | Agent、工具、DAG 节点与 elapsed | Stop、打开详情 |
| failed | 失败阶段与原始错误 | Retry、编辑任务 |
| completed | 摘要、产物、验收结果 | 打开详情、复制摘要 |
| cancelled | 已取消及取消时间 | Retry |

Chat 自身的 Stop 和正式 Task 的 Stop 必须区分：

- Composer Stop：终止当前 Pi Chat streaming。
- TaskReceipt Stop：终止该 Task 的 active AgentTask / WorkflowRun。

## 18. 为什么不能让每条普通 Chat 自动创建 Kanban Task

| 普通 Chat | 正式 Kanban Task |
|---|---|
| 探索、澄清、试问 | 已决定要执行的工作 |
| 私密、单会话 | 可共享、可审计、可转交 |
| 一句话可能只是上下文 | 需要稳定标题与责任边界 |
| 多轮对话持续修正意图 | 一个对象持续承载多次执行 |
| 可以没有验收标准 | 应能判断是否完成 |
| 不一定值得长期保留 | 应进入项目历史和统计 |

如果每条普通消息自动建卡，会导致：

- 看板卡片泛滥；
- 一段对话产生多个重复 Issue；
- 尚未澄清的意图成为正式承诺；
- executionTarget 被模型任意猜测；
- 临时工具调用混入项目统计；
- Squad、Schedule、Webhook、DAG 找不到稳定接管边界。

Multica 通过 ChatTask.issue_id = NULL、独立 Quick Create 和显式 /issue，已经在三个层面保护了这个边界。

## 19. 最小实施边界

为了保持 Stella 简单，本轮 Chat-first 交互不需要：

- 新建第二套 Chat 消息数据库；
- 新建第二套 AgentTaskQueue；
- 实现多人 Agent 群聊；
- 复制 Multica 的 Redis/PostgreSQL、多租户权限与 Inbox；
- 让 LLM 自由决定是否偷偷创建任务；
- 一次性把 Workspace、Project、Agent、Skill 全部改成 Chat 创建；
- 在 Chat 内嵌完整 DAG 编辑器。

最小需要：

1. ComposerIntent：chat、task、workflow。
2. TaskDraft schema 与生成入口。
3. TaskDraft 确认卡。
4. 复用 boardCreateTask。
5. 可选复用 boardDispatchTask。
6. TaskReceipt 读取同一个 KanbanTask / AgentTask 状态。
7. 明确区分 Chat Stop 与 Task Stop。
8. 明确区分上下文 mention 与执行 mention。

## 20. 验收标准

### 20.1 正常路径

- 用户可在 Chat Composer 切换“对话 / 创建任务 / 运行流程”。
- 普通对话仍只发送 Pi prompt，不创建 Kanban Task。
- /task 与“固化为任务”能生成同一种 TaskDraft。
- Draft 至少展示 title、description、acceptanceCriteria、priority、executionTarget。
- 用户确认前不写 BoardRepository、不创建 AgentTask。
- “仅创建”只生成 planned Task。
- “创建并启动”先创建再分发，不并行调用。
- 创建后 Chat 显示同一 Task ID 的 Receipt。
- 从 Receipt 打开看板能看到同一个对象。

### 20.2 失败与恢复

- Draft schema 错误原样可见，不创建模糊兜底任务。
- 找不到 Agent/Squad/Workflow 时要求选择。
- create 失败时不显示成功 Receipt。
- create 成功、dispatch 失败时保留卡片并明确显示部分成功。
- 重复点击确认不会产生重复 Task。
- 应用刷新后已创建 Receipt 可从 sourceTaskId 恢复，或至少能通过看板重新打开。
- Stop Chat 不会错误取消正式 Task。
- Stop Task 不会错误结束当前 Pi session。

### 20.3 委派

- 普通 Chat 的 @Agent 不会无提示创建子任务。
- TaskDraft 中选择 Agent/Squad/Workflow 会写入 executionTarget。
- 已有 Task 评论 @mention 继续创建真实 AgentTask。
- Squad Receipt 可显示 Leader 和成员子任务状态。

## 21. 最终判断

Multica 的源码支持以下清晰结论：

1. **它已经通过 Chatbot 开启 AgentTask。** 每条 Direct Chat 消息都原子创建真实后台任务并由 Daemon 执行。
2. **它没有让普通 Chat 默认创建 Kanban Issue。** ChatTask 的 issue_id 明确为空。
3. **它已经支持自然语言创建正式 Issue。** Web Quick Create 与外部频道 /issue 都是显式意图入口。
4. **它把 Squad 动态协作放在正式 Issue thread。** Direct Chat 仍是固定单 Agent。
5. **Chat 中 @Agent/@Squad 存在 UI 与后端语义错位。** 这不应被 Stella 复制。
6. **当前官方 Chat 文档已经落后于运行代码。** 固定提交的 runtime brief 明确允许 Chat Agent 在权限范围内使用 issue CLI。
7. **Stella 当前并非产品上拒绝 Chat-first，而是尚未实现桥。** Composer 只发 Pi prompt，Kanban 只从 TaskEditorDialog 创建。

所以 Stella 最合理、也最简单的最终交互是：

    Stella Chat
       ├── 普通对话 → 当前 Pi 会话
       ├── 固化为任务 → TaskDraft → 用户确认 → KanbanTask
       └── 运行团队/流程 → TaskDraft → 用户确认 → KanbanTask → DAG / AgentTasks

这既满足“通过 Chatbot 开启任务”的直觉，又保留 Kanban 对责任、状态、审计和自动化的确定性；同时复用当前 BoardService、AgentTaskService、WorkflowOrchestrator 与 AgentTaskRunner，不引入第二套队列或复杂群聊系统。

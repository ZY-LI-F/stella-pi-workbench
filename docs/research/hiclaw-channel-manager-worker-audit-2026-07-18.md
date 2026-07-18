# HiClaw / AgentTeams 频道协作、Pi Agent 能力与 Stella 轻量化方案审计

> 审计日期：2026-07-18（Asia/Shanghai）
>
> AgentTeams 固定提交：`bdc4f640828d8ca3eb8db2cee53eebd875d827f5`
>
> Pi 固定提交：`3da591ab74ab9ab407e72ed882600b2c851fae21`
>
> pi-chat 固定提交：`9adbd29b40ee27ff1decf0fc87cbe180b40924f5`
>
> Stella 固定提交：`1cb25fd1b6124f8c661c046f77a3a262caa495a3`
>
> 证据范围：上述项目的官方仓库、当前源码、官方文档和 Stella 当前源码；产品建议与源码事实分开标注。

## 1. 结论先行

用户所说的阿里 HiClaw 当前已更名并迁移为 **AgentTeams（formerly HiClaw）**。官方把它定义为一个协作式多 Agent 运行平台：Manager 统一编排 Worker，Matrix 房间提供人类可见、可干预的协作界面，Manager、Team Leader 和 Worker 则是受控制器管理的长期 Agent 身份。[AgentTeams README L13-L29](https://github.com/agentscope-ai/AgentTeams/blob/bdc4f640828d8ca3eb8db2cee53eebd875d827f5/README.md#L13-L29)

最重要的判断有四个：

1. **AgentTeams 的 `@mention` 是唤醒与投递协议，不是任务数据库。** 正式项目、DAG、委派和结果验收由结构化工具及共享任务数据维护。
2. **Pi 核心没有一等的 LeadAgent 或 Subagent 团队模型。** Pi 明确选择不内置 subagent；官方示例扩展可以为子任务拉起独立 Pi 进程，但不提供持久团队身份、房间、心跳或项目验收。
3. **Stella 已有“半个团队系统”。** 它已经持久化 AgentTask、父子委派、Squad Leader 和真实 Pi 运行；但当前 Leader 只做首轮文本委派，不会在成员完成后重新验收和重规划。
4. **不建议给 Stella 复制 Matrix、MinIO、Kubernetes CRD 和多容器控制器。** 更适合桌面产品的方案是“Task Room + Coordinator”：保留看板和 AgentTaskQueue，给每个正式任务一个内部协作线程，让一个可恢复的 Coordinator Pi 会话通过结构化工具委派、验收和重规划。

一句产品定义：

> Stella 是完整 Pi 工作台与本地 Agent 任务控制台的组合：Pi 工作台独立保留全部直接使用能力；在用户明确固化工作后，Chat 捕获意图，Task Room 协调一次任务，Kanban 监督全部任务，DAG 表达确定性依赖，Pi 执行每一次 AgentTask。

## 2. AgentTeams 不是单纯的“Agent 群聊”

### 2.1 两层协调者

AgentTeams 当前至少有两层类似 LeadAgent 的角色：

```text
Human Admin
    ↓
Manager（全局路由、Worker/Team 管理）
    ↓
Team Leader（团队内部拆解、委派、验收、重规划）
    ↓
Team Workers（执行具体任务）
```

Team 由一个 Team Leader 和多个 Worker 组成。Team Leader 本质上也是 Worker 容器，但注入了团队管理技能；Manager 只把任务交给 Leader，不直接越级联系团队 Worker。[team-management SKILL L8-L38](https://github.com/agentscope-ai/AgentTeams/blob/bdc4f640828d8ca3eb8db2cee53eebd875d827f5/manager/agent/skills/team-management/SKILL.md#L8-L38)

因此 HiClaw 语境中的 LeadAgent 不是“一次模型调用的父 Agent”，而是拥有以下属性的受管身份：

- 独立 Agent runtime / 容器；
- Matrix 用户身份和房间成员关系；
- 固定的协调提示词与管理技能；
- 项目和任务工具；
- 存储空间、生命周期和 heartbeat；
- 能在 Worker 返回结果后被再次唤醒，决定接受、修订或重规划。

声明式资源文档也明确区分 Worker、Team、Human 和 Manager；Worker 是“容器 + Matrix 账号 + MinIO 空间”，Team 是“Leader + N Workers + Team Room”。[declarative resource management L24-L43](https://github.com/agentscope-ai/AgentTeams/blob/bdc4f640828d8ca3eb8db2cee53eebd875d827f5/docs/declarative-resource-management.md#L24-L43)

### 2.2 房间是可见的协作平面

当前 Team 模型不是所有人挤在一个无边界群中，而是通过房间建立权限和委派边界：

| 房间 | 典型成员 | 主要用途 |
|---|---|---|
| Leader Room | Manager、Global Admin、Leader | Manager 向 Leader 委派 |
| Team Room | Leader、Team Admin、全体 Workers | Leader 分配团队工作，成员报告 |
| Leader DM | Team Admin、Leader | 团队管理和直接请求 |
| Worker Room | Leader、Team Admin、单个 Worker | 单个 Worker 的私密协作 |

控制器创建 Team 时会创建 Team Room 和 Leader DM，并把房间 ID、团队成员及协调上下文注入 Leader 工作区。[create-team L60-L72](https://github.com/agentscope-ai/AgentTeams/blob/bdc4f640828d8ca3eb8db2cee53eebd875d827f5/manager/agent/skills/team-management/references/create-team.md#L60-L72)

这说明“频道”代表协作上下文和可见性边界，并不严格等于一个 Task。一个 Project Room 或 Team Room 可以承载多个具有依赖关系的执行单元。

### 2.3 `@mention` 负责唤醒，结构化状态负责可靠性

AgentTeams 的 Leader 规则明确区分两个动作：

1. `taskflow(delegate_task)` 创建并发布结构化任务状态；
2. 在 Team Room 发送包含 Worker 完整 Matrix ID 的可见 `@mention`，真正通知 Worker。

规则直接强调：`taskflow(delegate_task)` 本身不会通知 Worker；成功委派后必须发送 Team Room 消息。[Team Leader AGENTS L81-L98](https://github.com/agentscope-ai/AgentTeams/blob/bdc4f640828d8ca3eb8db2cee53eebd875d827f5/manager/agent/team-leader-agent/AGENTS.md#L81-L98)

因此它的真实语义是：

```text
结构化 task/project state = 事实来源
Matrix @mention             = 投递、唤醒、可见通知
Room timeline               = 人类观察与干预界面
```

这比“扫描一段最终回复里出现了哪些 @名字”更可靠。消息发送失败不会伪装成已分配，任务状态也不需要靠聊天历史反推。

### 2.4 Leader 必须验收，而不是 Worker 自报成功即推进

复杂任务可以进入 Project / DAG 模式。Worker 报告 `SUCCESS` 后，Leader仍需对照交付标准检查结果；只有 Leader 接受并把 DAG 节点标记为 `[x]`，依赖才算满足。`REVISION_NEEDED`、`BLOCKED` 和中断需要 Leader 决定新的计划。[DAG task rules L34-L70](https://github.com/agentscope-ai/AgentTeams/blob/bdc4f640828d8ca3eb8db2cee53eebd875d827f5/manager/agent/team-leader-agent/skills/task-management/references/dag-tasks.md#L34-L70)

Leader 采用事件驱动的继续方式：委派后结束当前 turn；Worker 完成、阻塞、用户指令或 heartbeat 异常产生新事件时，再恢复协调。它不是在一个 LLM turn 内无限等待和轮询。[Team Leader AGENTS L168-L178](https://github.com/agentscope-ai/AgentTeams/blob/bdc4f640828d8ca3eb8db2cee53eebd875d827f5/manager/agent/team-leader-agent/AGENTS.md#L168-L178)

### 2.5 AgentTeams 的代价

这些能力来自一整套基础设施，而不是一个聊天组件：

- Element + Tuwunel / Matrix；
- Manager 和多个 Worker 容器；
- MinIO 共享存储；
- Higress gateway；
- AgentTeams controller；
- Docker 或 Kubernetes / Helm；
- 身份、房间、权限、容器状态和 heartbeat。

官方本地快速开始要求 Docker Desktop/Engine，给出的最低资源是 2 CPU + 4 GB，多个 Worker 推荐 4 CPU + 8 GB；Kubernetes 安装还会部署 gateway、Matrix、MinIO 和 controller。[AgentTeams README L60-L84](https://github.com/agentscope-ai/AgentTeams/blob/bdc4f640828d8ca3eb8db2cee53eebd875d827f5/README.md#L60-L84)

对一个希望打包给普通 Windows/macOS 用户安装的轻量 Electron 应用，这是一项明显的产品和运维成本。

## 3. Pi 是否有 LeadAgent 和 Subagent

### 3.1 Pi 核心：没有一等团队模型

Pi 官方 README 明确写明，它跳过了 sub agents 和 plan mode，鼓励用户按自己的工作流构建扩展或安装包。[Pi README L13-L20](https://github.com/earendil-works/pi/blob/3da591ab74ab9ab407e72ed882600b2c851fae21/packages/coding-agent/README.md#L13-L20)

其设计哲学进一步写明“No sub-agents”，并建议通过 tmux 启动多个 Pi、编写扩展或安装第三方包。[Pi README L489-L501](https://github.com/earendil-works/pi/blob/3da591ab74ab9ab407e72ed882600b2c851fae21/packages/coding-agent/README.md#L489-L501)

所以准确回答是：

- Pi 核心没有 `LeadAgent` 实体；
- Pi 核心没有 `Team`、`Worker`、`Room` 或持久父子任务状态；
- 一个 Pi 会话可以被提示为 Leader，但这是提示词角色，不是运行时保证；
- Pi 的价值在于可扩展 Agent loop、工具、会话和独立进程执行能力。

### 3.2 官方 subagent 示例：有机制，没有团队语义

Pi 仓库包含官方 subagent 示例扩展。它为每次 subagent 调用启动独立 `pi` 进程，让子任务拥有隔离上下文，并支持 single、parallel 和 chain 模式。[subagent example L1-L12](https://github.com/earendil-works/pi/blob/3da591ab74ab9ab407e72ed882600b2c851fae21/packages/coding-agent/examples/extensions/subagent/index.ts#L1-L12)

子进程使用 JSON 模式并传入 `--no-session`，由父 Pi 解析事件和最终结果。[subagent example L267-L335](https://github.com/earendil-works/pi/blob/3da591ab74ab9ab407e72ed882600b2c851fae21/packages/coding-agent/examples/extensions/subagent/index.ts#L267-L335)

它适合临时委派，但没有提供：

- durable AgentTask queue；
- 子任务身份和跨应用重启恢复；
- Task / Project / DAG 事实源；
- Worker room 和人类介入；
- Leader 后续验收与重规划；
- heartbeat 和受管 Worker 生命周期。

因此不应把这个示例直接当成 Stella 的团队后端。更稳的分工是：**Stella 创建和持久化子 AgentTask，Pi 只执行其中一个 AgentTask。**

### 3.3 pi-chat：频道桥接，不是 Leader/Worker 编排

`earendil-works/pi-chat` 是 Pi 生态中的独立官方仓库，不属于 Pi 核心包。它把 Discord/Telegram 频道桥接到沙箱化 Pi 会话；每个连接频道拥有自己的 Gondolin micro-VM、持久工作区、共享存储、记忆和技能。[pi-chat README L1-L25](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/README.md#L1-L25)

群聊默认只有 mention 才触发，DM 默认每条消息触发。[pi-chat runtime L160-L177](https://github.com/earendil-works/pi-chat/blob/9adbd29b40ee27ff1decf0fc87cbe180b40924f5/src/runtime.ts#L160-L177)

它证明 Pi 可以接入频道并按 mention 唤醒，但其基本拓扑仍是“一个频道对应一个 Pi 会话”，没有 AgentTeams 那种 Manager → Team Leader → Workers 的持久协调层。

## 4. 当前 Stella 已经具备什么

当前 Stella 并非从零开始：

- `AgentTaskKind` 已区分 `direct`、`mention-root`、`squad-leader` 和 `delegated`；
- AgentTask 有 `parentAgentTaskId`，能持久表达父子关系；
- Squad 保存 `leaderAgentId` 和 `memberAgentIds`；
- `dispatchSquad()` 会创建真实的 Leader AgentTask；
- Leader 输出提及成员后，Stella 会为每个成员创建真实 delegated AgentTask；
- 子任务、输出、评论、活动和 Pi 会话信息都由 Stella 保存。

领域类型见 [kanban.ts L194-L226](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/shared/kanban.ts#L194-L226)，Squad 分发及完成逻辑见 [agent-task-service.ts L148-L333](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/agent-task-service.ts#L148-L333)。

相较 Pi subagent 示例，Stella 已经多出了持久队列、任务谱系、看板状态和重启后的可审计记录。

## 5. 当前 Stella 与真正 Coordinator 的差距

### 5.1 当前 Leader 是一次性提示词路由器

Leader prompt 要求在最终回复中使用精确 `@mention`；Stella 随后扫描输出创建子 AgentTask。[agent-task-service.ts L567-L583](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/agent-task-service.ts#L567-L583)

这带来三个问题：

1. 自然语言既是给用户看的回答，又被当作机器命令；
2. 委派参数只有“提及了谁”，缺少明确 spec、依赖、验收标准和原因；
3. 文本解析成功不等于被委派 Agent 已经收到一项可验证任务。

### 5.2 Leader 不会回来验收

成员完成后，当前代码只检查所有子 AgentTask 是否都为 `succeeded`；随后直接把父 Leader 标成 succeeded，并把看板 Task 移到 review。没有重新唤醒 Leader 检查结果、请求修订或更新 DAG。[agent-task-service.ts L302-L333](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/agent-task-service.ts#L302-L333)

因此当前语义更接近：

```text
一次 Leader 分析
    → 一次文本 @mention 委派
        → 若干 Worker 执行
            → 全部进程成功即结束
```

而 AgentTeams 的 Coordinator 语义是：

```text
分析
    → 结构化委派
        → Worker 交付
            → Leader 验收
                ├─ 接受并推进依赖
                ├─ 请求修订
                ├─ 重规划
                └─ 请求人工决定
```

### 5.3 当前队列全局串行

`claimNext()` 发现任意 AgentTask 处于 running 时就不再领取新任务，因此即使多个子任务互不依赖，当前也不会并行运行。[agent-task-service.ts L166-L205](https://github.com/ZY-LI-F/stella-pi-workbench/blob/1cb25fd1b6124f8c661c046f77a3a262caa495a3/src/main/agent-task-service.ts#L166-L205)

这不是简单提高并发数就能解决：多个编码 Agent 同时修改同一个工作目录会产生写冲突。AgentTeams 用独立容器和共享产物协议隔离；Stella 若保持简单，应先把“并行执行”和“共享工作区写入策略”分开设计，而不是隐式放开所有任务。

### 5.4 没有任务级协作房间

当前 Task Comment 是持久消息和 mention 入口，但没有明确的 Task Room / Coordinator Session 概念。用户看到的是看板详情、评论、执行记录和普通 Pi Chat 的多个入口，难以判断：

- 此刻在和谁对话；
- 这条消息只是讨论，还是会创建 AgentTask；
- Leader 是一次运行还是持续角色；
- Worker 结果会由谁验收；
- Chat、Kanban 和 DAG 哪一个才是真实状态。

这正是产品困惑的主要来源，不只是缺少一个群聊 UI。

## 6. 三个项目的能力对照

| 能力 | AgentTeams | Pi / pi-chat | 当前 Stella |
|---|---|---|---|
| Lead 身份 | 持久 Manager、Team Leader | 核心无；可用提示词模拟 | 一次 `squad-leader` AgentTask |
| 子执行者 | 受管 Worker 容器 | subagent 示例拉起临时 Pi 进程 | 持久 delegated AgentTask |
| 协作频道 | Matrix 多类 Room | pi-chat 一频道一 Pi 会话 | Task Comment，无 Task Room 实体 |
| mention | 运行时投递/唤醒 | pi-chat 可作触发器 | 扫描评论或 Leader 最终文本 |
| 任务事实源 | projectflow/taskflow + 共享任务数据 | 无团队事实源 | Task、AgentTask、Workflow Run |
| 结果验收 | Leader 接受后 DAG 才推进 | 父进程收集结果 | 全部子任务 succeeded 后自动结束 |
| 恢复/巡检 | heartbeat、存储、控制器 | 会话可持久；示例子任务 `--no-session` | 应用层状态可恢复，暂无协调事件重入 |
| 隔离/并行 | 独立容器 | 独立进程，可并行 | 当前全局串行、共享工作目录 |
| 部署成本 | Docker/K8s + 多服务 | 低到中 | 低，桌面安装 |

## 7. 可探索的四条路线

### 路线 A：保持纯看板优先

继续把 Task Detail / Comment 作为主要交互，Squad Leader 只做首轮委派。

- 优点：最简单、确定、桌面友好。
- 缺点：用户感觉像操作后台队列，不像在带一个 Agent 团队；Leader 名称持续制造“它会协调到底”的错误预期。

### 路线 B：完整复制 AgentTeams

引入 Matrix、房间身份、Leader/Worker 进程、共享存储、heartbeat 和容器隔离。

- 优点：多人和多 Agent 协作可见，外部 IM 与移动端天然可用。
- 缺点：部署、资源、权限、升级和故障面显著扩大，与轻量 Windows/macOS 安装目标冲突。

### 路线 C：直接采用 Pi subagent 扩展

让一个父 Pi 进程临时拉起多个子 Pi。

- 优点：代码少，单次任务里容易获得并行探索。
- 缺点：绕过 Stella 的持久队列与恢复，难以形成稳定的 Kanban/DAG/验收语义；不适合作为产品主模型。

### 路线 D：内部 Task Room + 持久 Coordinator（推荐）

只借鉴 AgentTeams 的交互原则和协调协议，不复制基础设施：

```text
Global Stella Chat
    │ 讨论 / 生成 TaskDraft / 用户确认
    ▼
Formal Task ───────────────→ Kanban（跨任务监督）
    │
    ├─ Task Room（用户、Coordinator、结构化执行回执）
    │       │
    │       └─ Coordinator Session（可恢复 Pi 会话）
    │                    │
    │                    ├─ delegate(...)
    │                    ├─ accept(...)
    │                    ├─ request_revision(...)
    │                    └─ replan(...)
    │
    ├─ AgentTaskQueue ──→ Worker Pi runs
    │
    └─ Workflow / DAG（确定性依赖和人工关卡）
```

这种设计保留一个事实源：Task、AgentTask、Workflow Run / DAG 始终由 Stella 持有。Task Room 只是人类友好的控制与观察界面，未来若接入 Discord、Telegram 或 Matrix，也只是 Channel Adapter。

## 8. 推荐的领域语言

为避免继续混淆，建议采用以下词义：

| 术语 | 精确含义 |
|---|---|
| Global Chat | 用户探索、澄清和生成 TaskDraft 的普通 Pi 对话；不自动成为正式任务 |
| Task | 看板上的持久工作项，是目标和生命周期事实源 |
| Task Room | 围绕一个 Task 的内部协作线程，显示用户消息、协调消息和结构化执行回执 |
| Coordinator | 绑定 Task/Squad 的可恢复协调会话，负责委派、验收、修订和重规划 |
| Agent Definition | Worker 的职责配置，不是运行进程 |
| AgentTask | 某个 Agent Definition 的一次真实执行 |
| Squad | Coordinator 根据事件自适应委派的团队模式 |
| Workflow / DAG | Stella 按预定义依赖确定性推进的流程模式 |
| Channel | Discord/Telegram/Matrix 等可选外部消息传输，不是任务状态 |

不建议把 `Subagent` 作为 Stella 的领域实体。Pi 示例中的 subagent 是临时子进程，AgentTeams 的 Worker 是受管身份，而 Stella 真正持久化的是父 AgentTask 与子 AgentTask；三者不是同一个概念。

## 9. 推荐交互

### 9.1 从 Global Chat 建立任务

```text
用户：帮我审查支付模块，修复高风险问题并补测试。

Stella：我整理成以下任务草稿：
  标题：审查并修复支付模块高风险问题
  验收：风险项有结论；修复有测试；测试通过；输出摘要
  执行模式：适应型 Squad
  Coordinator：工程负责人
  Workers：侦察员、构建者、验证者

  [创建并启动] [仅创建] [继续修改]
```

确认后创建唯一 Task 和 Task Room，不让每句探索性聊天都污染 Kanban。

### 9.2 在 Task Room 中协调

用户不需要理解 queue API，可以直接发送：

```text
@工程负责人 先让侦察员只读分析，不要改代码；给我方案后再决定。
```

这里 `@Coordinator` 的语义是投递一个新协调事件。Coordinator 要委派 Worker 时必须调用结构化工具；普通文本“我让构建者开始”不应被视为已委派。

### 9.3 结构化执行回执

Task Room 不应把所有工具日志刷成群聊，而应混合消息和卡片：

```text
[委派] 侦察员 / 分析支付模块风险
状态：Running   依赖：无   只读：是

[交付] 侦察员 / SUCCESS_WITH_NOTES
产物：风险清单.md
[Coordinator 验收] [请求修订] [查看详情]
```

详细 token、命令和日志放在可展开执行详情；关键委派、阻塞、人工决定和最终结论进入房间时间线。

### 9.4 Squad 与 Workflow 不合并

- **Squad**：需求尚不确定，Coordinator 根据结果动态决定下一步。
- **Workflow / DAG**：步骤和依赖可预定义，需要可重复、可审计、可插入 Human Gate。

两者可以使用同一 Task Room、AgentTaskQueue 和执行卡片，但决策权不同：Squad 由 Coordinator 决策，Workflow 由 Stella 状态机决策。

## 10. 最小架构边界

推荐保留以下边界：

1. **Pi 工作台完整独立。** 当前项目、会话、模型、命令、扩展、工具、分支、终端和上下文页面不依赖 Task，也不被 Task Room 替换。
2. **Stella 持有任务状态，Pi 执行 turn。** Pi 不直接成为第二套队列和项目数据库；交互式 Pi 会话与任务执行会话彼此隔离。
3. **Chat 与 Task 之间只有显式转换。** 普通 Pi 消息不会自动建卡，“固化为任务”及“在 Pi 中打开执行”都必须是用户可见动作。
4. **`@mention` 只投递事件，不偷偷改变状态。** 真正委派必须产生 AgentTask。
5. **Coordinator 是会话，不是常驻无限循环。** 用户消息、Worker 交付、阻塞、Gate 或调度事件到来时恢复一个 turn；处理后再次等待。
6. **Worker 成功不等于任务被接受。** 由 Coordinator 或确定性 Workflow 验收后才推进依赖。
7. **Task Room 是投影，不是事实源。** Kanban、DAG 和房间看到的是同一 Task/AgentTask ID。
8. **外部 Channel 是适配器。** 首版不需要 Matrix；以后接入 IM 时映射同一 Task Room 事件即可。
9. **并行与工作区隔离分开决策。** 只读工作可安全并行；多个写入型编码任务必须先有独立 worktree、沙箱或明确的写入所有权。

## 11. 最终判断

Pi **可以承载** LeadAgent / Subagent 风格的执行，但 Pi 核心 **没有提供** HiClaw 那种一等 Manager、Team Leader、Worker 和房间运行时。Stella 应把 Pi 当作可恢复执行引擎，而不是等待 Pi 替自己定义团队领域。

当前 Stella 的方向没有错：Task、AgentTask、Squad、Workflow 和本地 Pi runner 已经构成可靠骨架。真正需要调整的是产品中心和协调闭环：

- 从“看板卡片里点分发”提升为“Chat 捕获意图，Task Room 持续协调”；
- 从“一次 Leader 最终文本解析”提升为“Coordinator 结构化委派”；
- 从“所有子进程成功即结束”提升为“结果验收、修订和重规划”；
- 从“聊天、看板、DAG 相互竞争”明确为“同一 Task 的交互视图、监督视图和依赖视图”。

这能获得 HiClaw 最有价值的部分——自然委派、协作可见、人工介入和长期协调——同时保留 Stella 作为简单、可安装桌面应用的核心优势。

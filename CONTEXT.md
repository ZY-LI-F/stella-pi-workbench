# Stella 领域词汇

Stella 是一个本地桌面 Agent 工作台，由完整独立的 Pi 工作台与可选的任务控制台组成。用户既可以直接使用 Pi，也可以把长期工作固化为看板任务，再选择固定工作流、单个 Agent 或动态 Squad 执行。

- **Pi 工作台（Pi Workspace）**：直接使用交互式 Pi 的一等产品界面，完整保留项目、会话、模型、命令、扩展、工具、分支、终端和上下文能力；它不依赖 Task 或 AgentTask 才能存在。
- **任务控制台（Task Control）**：管理 Task、Kanban、Task Room、Squad、Workflow、DAG 和 Autopilot 的可选产品界面。它与 Pi 工作台并列，而不是 Pi 工作台的替代品。
- **任务室（Task Room）**：围绕一个正式 Task 展示用户消息、协调消息和结构化执行回执的协作时间线。它是 Task 状态的交互投影，不是新的任务事实来源，也不是外部聊天频道。
- **协调者（Coordinator）**：绑定 Task 或 Squad、可在多个事件之间恢复的协调身份，负责结构化委派、验收、修订和重规划。它不同于只负责首轮委派的一次 Leader AgentTask。

- **任务（Task）**：看板上长期存在的一项业务工作，包含目标、项目、优先级和验收标准。任务不是执行队列项，也不等同于一次 Pi 会话。
- **任务评论（Task Comment）**：围绕任务保存的用户或 Agent 消息。用户评论中的有效 `@mention` 可以显式请求某个 Agent 执行；评论本身不是外部聊天频道，也不是任务状态的事实来源。
- **执行角色（Agent Definition）**：固定且带版本的职责配置，例如侦察员、规划师、构建者；它不是正在运行的进程。
- **Agent 任务（AgentTask）**：一次可持久化、可排队的 Agent 执行请求。它记录目标 Agent、父子委派关系、状态、Pi 会话和最终输出。
- **团队模板（Team Definition）**：固定工作流使用的一组确定性角色席位，表达谁负责哪个预设步骤。
- **动态小队（Squad）**：由一名 Leader 执行角色和若干成员执行角色组成的自适应委派配置。角色之间的层级体现在 AgentTask 父子关系中，不改变 Agent Definition 本身。
- **Leader 任务（Leader AgentTask）**：动态小队中负责分析并决定首轮成员委派的一次 AgentTask。它不是持续在线、会在成员交付后再次验收和重规划的协调身份。
- **流程模板（Workflow Definition）**：由 Stella 持有的确定性执行定义，当前由顺序 Agent 步骤和人工关卡组成。
- **流程实例（Workflow Run）**：某个任务一次固定流程分发后生成的定义快照与运行记录。
- **步骤实例（Step Run）**：流程实例中一个步骤的状态、时间、会话和结果。
- **产物（Artifact）**：Agent 完成后保留的最终输出和可选会话信息，可供后续角色和人工验收查看。
- **人工关卡（Human Gate）**：只有用户明确批准或驳回后才能继续的固定流程步骤。
- **自动驾驶（Autopilot）**：把一个触发器和“创建并分发任务”的动作绑定起来的本地规则。触发器可以是手动、应用运行期间的周期计划或本机回环 Webhook。
- **自动驾驶运行（Autopilot Run）**：一次触发审计记录，保存触发来源、结果、创建的任务和显式错误；它不是 AgentTask。
- **分发（Dispatch）**：根据任务的执行目标创建固定 Workflow Run，或创建一个根 AgentTask，并开始相应执行。

“看板列”只表达任务所处阶段；“队列状态”只表达 AgentTask 生命周期；“会话”特指 Pi 会话；“Chat”不作为“Task Room”的同义词；“Team”不作为“Squad”或“Workflow”的同义词；“Subagent”不作为 Stella 的领域实体，执行层级应表述为父 AgentTask 与子 AgentTask。

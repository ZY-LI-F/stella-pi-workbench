# Pi 0.80.10 / main 源码审计与 Stella 当前设计复核

> 审计日期：2026-07-17  
> 审计对象：`earendil-works/pi`、Stella Pi Workbench 当前实现与 `docs/stella-v2-simple-technical-spec.md`  
> 结论基线：Stella 当前依赖的已发布版本 `@earendil-works/pi-coding-agent@0.80.10`，不是 Pi `main` 的未发布源码

## 1. 执行摘要

总体架构判断成立：**Stella 应当拥有 Project、Kanban、Agent Catalog、Team Role、可视化 DAG、Human Gate、Run/Node 状态与可移植产物；Pi 只承担一个 Agent 节点内的模型循环、工具调用和本机会话。** 这个边界与 Pi 的源码和官方定位一致，也比直接依赖 Pi 的实验性 orchestrator 或示例 subagent 扩展简单、稳定。

当前方案还不能被视为可公开分发的完整执行环境。发布前有四项阻断问题：

| 优先级 | 发现 | 影响 | 必须采取的最小动作 |
| --- | --- | --- | --- |
| P0 | 当前 `abort()` 先从内存删除活动运行，再直接 `runtime.stop()`；settle/fail 回调仍可并发提交 | 已中止 Run 可能被迟到回调改回 running/succeeded，甚至启动下一节点 | 先实现纯 Run reducer、预期状态和 Runtime token；终态不可逆；增加真实竞态测试 |
| P0 | 工作流中止没有先发 Pi RPC `abort`；Windows 的 `child.kill("SIGTERM")` 是强制终止，不会可靠执行 Pi 的 SIGTERM 清理 | Agent bash/孙进程可能遗留；文件写入可能仍在结束过程中 | `RPC abort -> 等待 settle/abort response -> 进程退出 -> 必要时 OS 进程树强杀`；Windows 兜底必须是 `taskkill /T /F` |
| P0 | “受限打开/只使用用户级资源”的产品文案与 Pi 实际行为不符；`--no-approve` 仍加载项目 `AGENTS.md`/`CLAUDE.md`，且不是沙箱 | 用户可能把输入加载开关误解为工具权限边界 | 拆清“项目资源加载许可”和“以当前用户权限执行”；未确认执行许可时不分发工具型 Agent；未信任项目显式 `--no-context-files` |
| P1（发布阻断） | Windows 的 Pi `bash` 工具要求外部 Bash；Stella 只内置 Pi，不内置 Git Bash。现有 packaged smoke 只执行 `get_state` | 安装包能启动，但 Builder/Tester/终端第一次运行命令即失败 | 启动前 shell preflight、README/首启说明 Git for Windows、打包测试真实执行 RPC `bash` |

另外还有三项应在 v2 数据模型定稿前修正：Pi `sessionPath` 是设备本地绝对路径，不能充当可移植产物身份；Pi 单次 Agent turn 默认可并行执行多个工具，Stella 只能承诺“不重叠运行多个 Agent 进程”，不能承诺“内部无并行写”；RPC 没有 login/logout 命令，安装包“无需全局 Pi”不等于“无需配置凭据”。

审计时现有 `workflow-orchestrator` 与 `board-store` 单元测试共 6 项通过，TypeScript 双端 typecheck 通过。这证明当前线性快乐路径基线可用，但现有测试没有覆盖 settle/abort、abort/runtime-exit、Windows bash 子进程树等关键竞态。

## 2. 精确版本边界：0.80.10 是契约，main 不是

### 2.1 Stella 实际使用的版本

Stella 的 `package.json` 精确固定了 `@earendil-works/pi-coding-agent: 0.80.10`，`package-lock.json` 解析到：

- tarball：`https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-0.80.10.tgz`
- integrity：`sha512-aL4apbupCHiVLSXASXvRzH4Q2vmtfrDa+0s909CJuVu/GgGylbDzr7oyF1mPmip5E+VxYYxKWmph4hV04wUcQg==`
- npm `gitHead`：`8dc78834cde4e329284cf505f9e3f99763df5529`

这个 SHA 正是 Pi 的 Release v0.80.10。该版本声明 Node `>=22.19.0`，包根导出公共 SDK/types，并明确导出 `./rpc-entry` 子路径；Stella 使用 `import.meta.resolve("@earendil-works/pi-coding-agent/rpc-entry")` 是受 package exports 支持的集成方式，而不是越过包边界读取私有文件。[0.80.10 package exports](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/package.json#L9-L29)

发布构建应继续保留三项硬校验：顶层依赖使用精确版本而非 `^`；lockfile integrity 不变；打包后从实际 `rpc-entry` 邻近 `package.json` 读取的版本必须是 `0.80.10`。Pi 发布包自带 shrinkwrap，Stella lockfile 也记录了 `hasShrinkwrap: true`，这比运行时查找用户的全局 `pi` 可复现得多。

### 2.2 2026-07-17 的 Pi main

审计时 `main` 精确为 [`f1a466b19d59cde009bd2d6da57b063518e299b8`](https://github.com/earendil-works/pi/commit/f1a466b19d59cde009bd2d6da57b063518e299b8)，提交信息为 `feat(coding-agent): add llama.cpp router integration`。它仅比 v0.80.10 发布提交晚一个提交，但仍是**未发布源码**；源码中的 package version 仍显示 `0.80.10`，不能据此把它当作 npm 0.80.10 的内容。

从 `8dc7883` 到 `f1a466b` 的差异主要是：

- 新增内置隐藏 llama.cpp extension、router client/provider/UI 和文档；main 文档要求另行启动支持 router 的 `llama-server`，再用 `/login llama.cpp` 配置。[main llama.cpp 文档](https://github.com/earendil-works/pi/blob/f1a466b19d59cde009bd2d6da57b063518e299b8/packages/coding-agent/docs/llama-cpp.md#L1-L64)
- 模型目录大规模重新生成，以及 native provider registration 支持。[main built-in extension](https://github.com/earendil-works/pi/blob/f1a466b19d59cde009bd2d6da57b063518e299b8/packages/coding-agent/src/extensions/index.ts#L1-L4)
- `agent-loop.ts`、RPC command/types/JSONL、`session-manager.ts`、bash 工具、进程树清理和 orchestrator 核心并未在该提交变化。

因此，本报告所有关于 RPC、settled、session、trust、bash 和 cancel 的可靠契约都固定引用 `8dc7883`；llama.cpp 只列为 main-only 观察，不进入 Stella 当前实现或验收标准。升级 Pi 时应按新 npm release 重新跑契约测试，不能直接跟踪 `main`。

## 3. Pi 的真实分层与 Stella 应复用的边界

Pi monorepo 的根 workspace 构建顺序是 `tui -> ai -> agent -> coding-agent -> orchestrator`，Node 基线也是 `>=22.19.0`。[root package](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/package.json#L5-L16)

| Pi 包 | 源码职责 | Stella 应如何使用 |
| --- | --- | --- |
| `pi-ai` | Provider、模型目录、认证解析、流式模型 API | 通过 coding-agent 间接使用；不要在 Stella 再造模型循环 |
| `pi-agent-core` | Agent 状态、turn loop、tool call、steer/follow-up、abort | 通过 coding-agent/RPC 间接使用 |
| `pi-coding-agent` | CLI、SDK、资源加载、会话树、内置 read/write/edit/bash、RPC | 当前稳定集成面；继续固定 0.80.10 |
| `pi-tui` | 终端 UI 组件 | Electron GUI 不应复用 |
| `pi-orchestrator` | 多 Pi RPC 实例 supervisor、IPC/socket、Radius 元数据 | 不作为 Stella v2 依赖 |

Pi 自己明确说明核心不内置 sub-agent、permission popup、plan mode、todo 或 background bash；这些要由 extension/package/外部编排实现。[Pi philosophy](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/README.md#L488-L504) 因此，可视化 DAG、固定团队和人工关卡不是“绕开 Pi”，而是 Pi 预期的上层组合方式。

### 3.1 subagent 只是示例扩展，不是内置团队运行时

仓库里的 `examples/extensions/subagent` 容易造成误判。它是需要用户手工 symlink 到 `~/.pi/agent/extensions` 的示例，README 还要求复制 Agent markdown 和 prompt templates；并非默认安装、稳定 API 或一等运行模型。[subagent 安装说明](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/examples/extensions/subagent/README.md#L14-L65)

示例本质上为每个子 Agent spawn 新 `pi` 进程、使用 JSON mode，并支持示例自身的 parallel/chain；在普通 Node runtime 下找不到当前 Pi script 时还会回退到 PATH 上的全局 `pi` 命令。[subagent spawn 逻辑](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/examples/extensions/subagent/index.ts#L239-L263) 这与 Stella 的“安装位置无关、固定版本、Run 可持久化、Human Gate 可重启恢复”目标相冲突。Stella 当前“每个 Agent 节点一个明确的 bundled RPC process”更可靠。

### 3.2 Pi orchestrator 也不是 Stella DAG 的替代品

`@earendil-works/pi-orchestrator` 的 README 第一段明确标注 experimental，CLI/API/行为可能无通知改变或删除。[orchestrator 状态](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/orchestrator/README.md#L1-L5) 它的核心也是 `process.execPath + @earendil-works/pi-coding-agent/rpc-entry` 启动单个 RPC 子进程，然后持有实例元数据和 IPC 转发。[orchestrator RPC process](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/orchestrator/src/rpc-process.ts#L25-L60)

它没有 Workflow graph、Team Role、Human Gate、业务 Kanban 或 Stella Run snapshot；额外引入 daemon/socket/Radius 只会增加层次。其 socket path 还是普通 `<config>/orchestrator.sock`，没有给出明确的 Windows named-pipe 路径策略。[orchestrator config](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/orchestrator/src/config.ts#L45-L69) 结论是：可以把它作为“Pi 官方也认可独立 RPC 进程 supervisor”这一模式的旁证，但不能依赖它实现 Stella v2。

## 4. Agent loop、并发与完成语义

### 4.1 一个 Pi Agent 节点内部做什么

Agent loop 会持续执行：模型响应 -> 解析 tool calls -> tool results -> 下一 turn；同时消费 steering 与 follow-up 队列，最后才发 `agent_end`。[agent loop](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/agent/src/agent-loop.ts#L155-L274)

需要修正 v2 文档里可能被过度理解的“串行”保证：Agent 默认 `toolExecution = "parallel"`；同一个模型响应中只要没有工具声明 sequential，多个 tool call 会 `Promise.all` 并行执行。[Agent 默认值](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/agent/src/agent.ts#L207-L229) [parallel tool batch](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/agent/src/agent-loop.ts#L413-L427) [并行实现](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/agent/src/agent-loop.ts#L491-L555)

Pi 对 `write`/`edit` 提供的是**同一文件 mutation queue**；不同文件仍可并行。这能避免同一文件的两个 mutation 重叠，但不是 workspace transaction，也不会串行 bash 与文件写。[file mutation queue](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/tools/file-mutation-queue.ts#L28-L60)

所以 Stella v2 可准确承诺：

1. 一个 Workflow Run 的 DAG 节点按持久化的稳定拓扑序调度；
2. 同一时刻不重叠启动两个 Workflow Agent RPC 进程（范围必须明确定义为 app-wide 或 workspace-wide）；
3. **不承诺**某一个 Pi Agent turn 内的所有 tool calls 串行。

若产品一定要求 tool-level 全串行，0.80.10 RPC 没有设置全局 `toolExecution` 的命令；需要改用 SDK、自定义 wrapper 或等待上游契约，都会显著增加复杂度。当前简化方案应接受 Pi 内部并行，并把文案写准确。

### 4.2 `prompt success` 不是完成

RPC `prompt` 会先启动异步 `session.prompt()`，只在 preflight 成功后回复 `{ success: true }`；后续模型/工具失败通过 event/message 出现，不会再发第二个 prompt error response。[RPC prompt handler](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L393-L430)

`agent_end` 也不是最稳妥的节点完成点，因为 Session 可能在它之后自动 retry、compaction 或继续处理 queue。`AgentSessionEvent` 为 `agent_end` 增加 `willRetry`，另有专门的 `agent_settled`。[事件类型](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L135-L162) `_runAgentPrompt()` 只有在 agent、post-run retry/compaction/queue 全部结束的 `finally` 中才发 settled。[settled 生命周期](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L1049-L1060)

Pi 自带 RPC client 的 `waitForIdle()` 同样以 `agent_settled` 为完成信号。[RPC client waitForIdle](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-client.ts#L443-L483) 当前 Stella 在 `agent_settled` 后读取 last assistant text/state/stats/messages 的做法是正确的，应保留。

### 4.3 RPC 帧与命令并发

RPC 使用严格 LF JSONL；客户端只能按 `\n` 分帧，不能把 U+2028/U+2029 当换行。Stella 当前 buffer parser 符合该契约。[strict JSONL](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/jsonl.ts#L4-L40)

命令集合包含 prompt/steer/follow_up/abort、新会话、模型与 thinking、retry/compaction、standalone bash/abort_bash，以及 session tree/stats/messages/export；没有 login/logout，也没有 DAG/Team/Gate 命令。[RPC command union](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-types.ts#L20-L72)

输入 reader 对每行调用 `void handleInputLine(line)`，没有建立全局串行 command queue，因此两个 RPC handler 可以重叠。[RPC input reader](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L726-L785) Stella 对 settle 后四个纯读取查询使用 `Promise.all` 没问题；但 prompt/abort/new_session/switch_session/standalone bash 等生命周期命令必须由 Stella runtime 自己串行化并始终按 response id 关联。

## 5. Cancel / abort 的源码证据与可靠顺序

这是当前实现风险最高的部分。

### 5.1 Pi 的正常 abort 链路

Pi RPC `abort` 会 `await session.abort()` 后才返回 success。[RPC abort](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L417-L430) `AgentSession.abort()` 会中止 retry、调用 `agent.abort()`，再等待 Session idle。[session abort](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L1527-L1541) Agent 的 abort controller signal 会传入当前 tool execution。[Agent abort](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/agent/src/agent.ts#L304-L320)

Pi 内置 bash 收到 AbortSignal 后调用 `killProcessTree(child.pid)`。Unix/macOS 的 bash 以独立 process group 启动；Windows 不使用 detached，改由 `taskkill /F /T /PID` 清理整个树。[bash spawn/abort](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/tools/bash.ts#L82-L145) [跨平台 killProcessTree](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/utils/shell.ts#L176-L224)

standalone RPC `bash` 使用另一个 `_bashAbortController`，必须通过 `abort_bash` 取消；普通 `abort` 只覆盖 Agent run。工作流节点里的 bash 是 Agent tool，普通 `abort` 足够；聊天终端抽屉发送的 RPC `bash` 则必须额外 `abort_bash`。[standalone bash controller](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L2700-L2777)

### 5.2 为什么当前 `runtime.stop()` 不够

Pi RPC 进程在 POSIX 收到 SIGTERM/SIGHUP 时，会先 `killTrackedDetachedChildren()`，再 dispose/exit。[RPC signal handler](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L365-L378) macOS 上，Stella 的 `child.kill("SIGTERM")` 通常能走到这条清理路径。

Windows 不存在 POSIX signal。Node 官方说明 `subprocess.kill("SIGTERM")` 在 Windows 会强制、突然终止目标，行为类似 SIGKILL；不能假设子进程的 `process.on("SIGTERM")` handler 会完成。[Node child_process 文档](https://nodejs.org/api/child_process.html#subprocesskillsignal) 因而当前 [`PiRpcRuntime.stop()`](../../src/main/pi-rpc-runtime.ts) 在 Windows 直接 kill Pi RPC，可能绕过 Pi 的 tracked-child cleanup，只杀掉 Pi 父进程而留下 bash/孙进程。

Pi 自己的 Windows `killProcessTree` 也采用 fire-and-forget `taskkill` 并忽略启动错误，所以 Stella 仍应把超时升级和实际 PID/命令记录成显式 diagnostic，不能静默声称清理成功。

### 5.3 Stella 的最小可靠取消算法

建议给 `PiRpcRuntime` 增加一个清晰的 `abortAndStop()`，而不是让 orchestrator 直接调用生硬的 `stop()`：

1. 在 BoardStore 的串行 transaction 中，以 `expectedStatus + runId + nodeId + runtimeToken` 执行终态转换；立即使 token 失效，任何迟到 settle/fail/exit 只能写 diagnostic，不能改 Run。
2. 暂时保留 workspace writer lease，不让下一可写节点在旧进程尚未退出时启动。
3. 若 stdio 仍健康：聊天 runtime 先发送并等待 `abort_bash`；所有 runtime 再发送 `abort`。`abort` response 已意味着 `session.abort()` 等到 idle；同时保留 `agent_settled` 作为事件证据。等待必须有一个明确、可配置且记录原因的 grace deadline，不能无限挂住应用退出。
4. abort 正常完成后关闭 stdin，并让进程退出；若当前仍无 RPC shutdown command，则 macOS 发 SIGTERM，让 Pi 自己清理 tracked bash。
5. Windows 若 abort/RPC 链路在 deadline 内失败，Stella 父进程必须执行 `taskkill /PID <piPid> /T /F` 并检查结果，而不是只 `child.kill("SIGKILL")`。
6. macOS 的 SIGTERM grace 失败后可以 SIGKILL Pi，但必须记录“可能存在未清理 detached tool process”的明确错误；若要宣称绝对无孤儿，需要补充 app-owned descendant supervisor 或上游可等待的 RPC shutdown，不能靠文案掩盖。
7. 确认 Pi 子进程退出后再释放 writer lease；persisted Run 已是 terminal，清理失败不允许把它改回 running/succeeded。

### 5.4 当前竞态的具体位置

当前 [`WorkflowOrchestrator.abort()`](../../src/main/workflow-orchestrator.ts) 先 `activeAgents.delete(runId)`、等待 `runtime.stop()`，再提交 interrupted；与此同时，已经进入 `#settleAgent(active)` 的异步路径仍可能完成四个 RPC 查询并提交 running/succeeded，然后 `#advance()` 启动下一节点。`#commit()` 只重新读取 Board，但 transform 没有校验 expected terminal status，也没有校验 active object/token。`#failRun()` 与 abort/runtime-exit 也存在同类顺序竞争。

v2 规格中“纯状态转换器、终态不可逆、transaction 内重读、stale runtime token”是正确修复方向，Phase 0 必须先于 DAG schema/UI。必测顺序包括：abort 正遇到 runtime.start、settled artifact 查询、runtime_exit；Human Gate approval 与 abort；旧 Run completion 在新 Run 创建后到达；Windows Agent bash 生成子进程后取消并验证整棵树消失。

## 6. Session、快照、事件与跨电脑可移植性

### 6.1 Pi session 是本地执行证据，不是 Stella 业务主键

Pi session v3 是 append-only JSONL tree。header 包含 `id`、timestamp、**绝对 cwd** 和可选的 **parentSession 绝对路径**；每个 entry 有 id/parentId/timestamp，并可记录 message、model/thinking change、compaction、branch summary、custom entry 和 label。[session schema](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L30-L125)

新 session 会先分配路径，但直到出现 assistant message 才首次落盘；因此 `get_state.sessionFile` 可能是一个尚未存在的预定路径，UI reveal 必须先检查存在性。[session delayed persistence](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L861-L886) [persist 条件](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L946-L980)

SDK 的 `SessionManager.open(path, ..., cwdOverride)` 支持在导入时改 cwd，但 RPC `switch_session` 没有 `cwdOverride` 字段。[SessionManager.open](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/session-manager.ts#L1436-L1461) 因而把另一台电脑的 session JSONL 直接交给现有 RPC resume 并不构成可靠的路径重绑定方案。

v2 数据模型应把节点执行引用写成类似：

```text
piSession: {
  sessionId: string
  localPath?: string       // device-local hint
  piVersion: string
}
```

`localPath` 只能用于当前设备上的“打开本地会话”，不存在时按钮禁用并说明原因。Project/Task/Run/Node 的身份必须继续使用 Stella UUID；跨电脑重绑定 Project workspace 后创建新本地 Pi session。当前保存的 final Markdown、token/cost 和 Run graph snapshot 才是可携带历史，不能要求 `sessionPath` 仍存在。

### 6.2 Stella 应持有什么快照

Run 创建时完整快照 Workflow graph、稳定 execution order、Team role map 和实际 Agent definitions 是正确选择。建议每个 NodeRun 再保存少量、稳定、足以解释执行的字段：

- requested 与 actual provider/model/thinking；
- Pi version、sessionId、本地 sessionPath hint；
- final assistant text、stopReason/error、start/end timestamps；
- token/cost；
- tool name + start/end/error 的归一化 Activity 摘要。

无需把每个流式 token 或完整 Pi JSONL 再复制一遍。Pi 已在 `message_end` 持久化 user/assistant/toolResult；本地深度取证可打开 session，Stella 只需保证没有 session 文件时 Run 仍完全可读。[message persistence](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/agent-session.ts#L573-L645)

一个 RPC 进程只服务一个 Stella Agent node 的现有做法也解决了事件关联问题：Pi event 本身不携带 Stella runId/nodeId，进程实例和 Runtime token 就是清晰的 correlation boundary。

## 7. Trust、安全与角色工具边界

Pi 官方的定义非常明确：project trust 只控制是否加载 `.pi/settings.json`、extensions/skills/prompts/themes、SYSTEM/APPEND_SYSTEM 和 project `.agents/skills`；它**不是沙箱**，不会限制模型随后让工具做什么。[Pi security](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/security.md#L3-L37)

更关键的是，`AGENTS.md`/`CLAUDE.md` 不受 project trust 保护，除非明确 `--no-context-files`，即使 `--no-approve` 也会加载。[project trust 与 context files](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/security.md#L20-L29)

Pi 内置 read/write/edit 接受相对或绝对路径，`resolveToCwd` 会处理 `~` 和绝对路径，但没有检查目标必须位于 cwd 内。[path resolution](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/core/tools/path-utils.ts#L40-L50) bash 更是以启动 Stella 的用户权限运行。因此：

- `allowedTools = [read, grep, find, ls]` 是“角色不提供写工具”的能力边界，但 read Agent 仍可读取用户账号可读的绝对路径；
- write/bash Agent 可以访问 workspace 外部；
- Renderer 的 Electron sandbox 只保护 Renderer，不会沙箱主进程启动的 Pi child；
- 对恶意或无人看管仓库要实现真正隔离，必须使用 OS/container/VM 边界，不属于当前 v2 的轻量范围。

当前工作流默认禁用 extensions、skills、prompt templates 是好的确定性措施，但没有传 `disableContextFiles`。当前 README/对话框说“受限打开只使用用户级资源”不准确，因为项目 `AGENTS.md` 仍可进入 system prompt。最小修正是：

1. 把 UI 名称改为“**不加载项目级 Pi 配置与扩展**”，附注“Pi 工具仍以当前用户权限运行；这不是沙箱”。
2. v2 内部至少区分 `projectResourcesApproved` 与 `executionApproved` 两个概念；若为了 UI 简化成一次确认，也要在领域层命名清楚。
3. 外部 workspace 未获得 execution approval 时可以浏览 Kanban，但不允许 dispatch/聊天工具/本地命令。
4. `projectResourcesApproved = false` 的 Agent 节点强制 `--no-approve --no-context-files --no-extensions --no-skills --no-prompt-templates`；如果用户希望保留 AGENTS.md，必须作为明确选择而非隐含行为。
5. app-managed workspace 可以默认信任 app 自己的配置，但仍不能称为 OS sandbox。

## 8. Windows / macOS 安装边界

### 8.1 “内置 Pi”实际包含什么

当前打包方法的核心是正确的：生产依赖内置在 app 中；`import.meta.resolve` 找 bundled `rpc-entry`；`process.execPath + ELECTRON_RUN_AS_NODE=1` 使用 Electron 自带 Node；不搜索接收者全局 `pi` 和安装路径。因此别人把 Stella 安到任意 Windows/macOS 目录，或全局 Pi 位于别处，都不影响 RPC 入口定位。

但“内置 Pi Runtime”不等于“内置完整开发环境”：

| 随 Stella 内置 | 仍由接收者环境提供 |
| --- | --- |
| Electron/Node、Pi 0.80.10 JS、production dependencies、GUI、RPC bridge | 模型凭据与网络、项目源码、Git/npm/Python/编译器等项目工具链、用户扩展/skills、Windows Bash |

### 8.2 Windows 明确要求外部 Bash

Pi 0.80.10 官方 Windows 文档写明：bash 工具按“用户 `shellPath` -> `C:\Program Files\Git\bin\bash.exe` -> PATH 上 bash.exe”查找，通常需要 Git for Windows。[Windows requirement](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/windows.md#L1-L17) 源码找不到 Bash 时会抛出显式错误，不会回退到 PowerShell/cmd。[shell resolution](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/utils/shell.ts#L60-L119)

当前 packaged e2e 清空 PATH 并验证 app、bundled RPC 和 `get_state`，这很好地证明“不依赖全局 pi”；但它没有执行 `bash`，也没有执行任何 Agent tool，不能证明 Builder/Tester/终端可用。

最小发布措施：

1. README 与首启 preflight 明示“Windows 需要 Git for Windows 或配置 `shellPath`”；不要把它藏到故障排查。
2. preflight 通过真实 RPC `bash` 执行无副作用命令并核验 stdout/exitCode；失败时显示 Pi 原始错误、已搜索位置和设置入口。
3. `tests/e2e/packaged.spec.ts` 在 Windows native runner 上保持 PATH 中无全局 pi，但实际发送 `{type:"bash", command:"printf stella-shell-ok"}` 并断言结果；GitHub Windows runner 的标准 Git Bash 路径可验证已知位置分支。
4. 新增取消测试：bash 创建可观测的长寿命子进程，调用 Stella abort，最终验证 Pi、bash 和孙进程 PID 均不存在。
5. release workflow 目前只 build/upload；必须在每个 Windows/macOS native matrix 产物上运行 packaged smoke 后再上传。

### 8.3 macOS

macOS 通常有 `/bin/bash`，Pi 找不到时还能回退到 PATH bash 或 `sh`，所以没有 Windows 同等的 shell 安装阻断。仍需在 Intel 与 Apple Silicon 原生 runner 分别验证：app 启动、bundled RPC、direct bash、项目路径含中文/空格、abort、签名/hardened runtime 和 notarization。当前 builder 的 x64/arm64 target、签名和公证开关方向正确；正式 tag 必须让 native packaged test 成为 Release 的前置条件，而不是只确认文件生成。

### 8.4 Provider 凭据是另一项首启前置条件

Pi 默认读取 `~/.pi/agent/auth.json`、models/settings/sessions，也允许 `PI_CODING_AGENT_DIR` 改目录。认证优先级是 CLI `--api-key`、auth.json、环境变量、models.json key；auth.json 以 0600 权限写入。[credential resolution](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/providers.md#L283-L290) [auth file permissions](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/docs/providers.md#L98-L120)

RPC command union没有 login/logout，所以“用户不安装全局 Pi CLI”时，当前 GUI 没有等价的凭据配置交互。最简单的 v2 发布口径可以仍然要求用户通过环境变量或标准 auth.json 预配置，但首启必须检测“没有可用模型/认证”并给出准确路径和 provider 变量，不能等用户分发后才出现模糊失败。若要做 GUI onboarding，0.80.10 公共导出包含 `ModelRuntime`，其 `login/logout` 可作为受版本约束的 SDK 入口；不要直接写 Pi 私有文件结构，也不要把开发者凭据打包进去。[public ModelRuntime export](https://github.com/earendil-works/pi/blob/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent/src/index.ts#L161-L175)

## 9. 对 Stella 当前实现与 v2 方案的逐项结论

| 设计项 | 结论 | 审计修正 |
| --- | --- | --- |
| Electron main 持有本地 authority | 保留 | filesystem、child process、trust、store 不进入 Renderer；现有 typed preload 方向正确 |
| 一个本地 JSON + 串行 atomic write | 保留 | 单用户桌面足够；migration 先备份、全量校验失败不覆盖原文件 |
| Project 与 directory 解耦 | 保留 | external path 是设备本地 binding；Run/Task 只引用 projectId |
| Task column 与 Run status 解耦 | 保留 | 当前 v1 会随运行改任务 status，v2 必须彻底去耦 |
| 内置 + 用户 Catalog | 保留 | built-in immutable/copy；Run 创建时完整 snapshot |
| Team Role 确定性映射 | 保留 | 不引入 leader LLM、round-robin 或 Agent group chat |
| Start/Agent Role/Human Gate/End DAG | 保留 | stable topo order、fan-out/fan-in、无条件边、无循环；React Flow 只负责编辑展示 |
| 串行 scheduler | 保留但精确定义 | 建议 app-wide 一次一个 Workflow Agent；至少 workspace-wide；Pi 节点内部工具仍可能并行 |
| Human Gate restart survival | 保留 | waiting gate 不需要活 Pi process；approval/reject 仍走 reducer + expected state |
| 每节点独立 Pi RPC | 保留 | 最清晰的 session/event/cancel 隔离边界 |
| 当前 writer lock | v2 替换/上收 | 当前按原始 path 只锁 write Agent，read Agent、另一个 project alias、手动聊天/终端仍可并发；统一 workspace lease 或 app-wide workflow semaphore |
| `agent_settled` 结算 | 保留 | prompt response 与 agent_end 不能作为完成 |
| sessionPath 作为 artifact 字段 | 降级为 optional local hint | 增存 sessionId/piVersion；历史输出不依赖该路径 |
| Trust boolean | 语义需重命名/拆分 | Pi project resource trust 与执行许可不是一回事；false 也不是 sandbox |
| Bundled Pi | 保留 | 精确固定 0.80.10；不跟踪 main；不查全局 pi |
| Pi experimental orchestrator / subagent example | 不采用 | 都不能提供 Stella 的稳定 DAG/Gate/snapshot/portable installer 契约 |

### 9.1 v2 规格需要直接修改的表述

1. 把“最终只有……一套 Pi Runtime”改成“一个 app-owned runtime adapter；每个活动 Agent node 一个独立 Pi RPC child”，避免与实际进程数混淆。
2. 把“同一时间只运行一个 Agent”明确为调度范围；若只约束 Workflow，必须说明同 workspace 的手动 chat/terminal 如何互斥。
3. 把“without parallel workspace writes”改为“without overlapping Agent-node processes”；Pi 内部不同文件 tool calls 仍可并行。
4. ExternalWorkspace 的 `trusted` 改成至少两个明确概念，或写清一个确认同时代表哪些许可；不能沿用“受限=沙箱”的暗示。
5. NodeRun/Artifact 的 `sessionPath` 标记为 device-local optional hint，并增加 sessionId/piVersion/actual model。
6. Phase 0 增加 RPC graceful abort 与 OS tree-kill，不只做状态 reducer。
7. Phase 3 packaged acceptance 增加 direct bash 与 orphan-process 检查；`get_state` 只能证明启动层。
8. 首次运行 acceptance 增加 credential readiness；若不做 GUI login，明确这是安装后的用户前置步骤。

## 10. 发布前最小验收门槛

### Pi 0.80.10 契约测试

- 实际加载的 package version、rpc-entry path 与 lock integrity 正确；
- strict LF parser 能保留 JSON 字符串中的 U+2028/U+2029；
- prompt response 只表示 accepted，节点直到 `agent_settled` 才完成；
- 自动 retry 出现多个 `agent_end` 时只结算一次；
- settle 后保存 actual model/sessionId/session local path/final text/stats；
- lifecycle commands 串行，read-only state queries 可并行；
- API 不依赖 Pi main-only llama.cpp 行为。

### Run/DAG 正确性测试

- terminal state reducer 拒绝任何迟到 settle/fail/approve；
- fan-out/fan-in 按 persisted stable order 执行，join 等待所有 predecessor；
- 一个 branch failure 后不启动其他 pending Agent；
- Gate 在重启后保持 waiting，approve/reject 与 abort 的竞争只有一个合法结果；
- abort 在 start、prompt、tool execution、settle artifact read、runtime exit 每个阶段都保持终态；
- manual Pi chat/terminal 与 Workflow 对同 workspace 的并发策略有可见、可测试行为。

### Native packaged 测试

- Windows x64、macOS x64、macOS arm64 都从打包产物启动 bundled 0.80.10；
- PATH 中没有全局 pi 仍能 `get_state`；
- direct RPC bash 真实成功；Windows 无 Bash 时展示明确 preflight，而非把 app 启动算成功；
- Windows/macOS 取消长寿命 bash 后无遗留子孙进程；
- 任意安装目录、含空格/中文的 workspace、用户自定义 `PI_CODING_AGENT_DIR` 均可用；
- 无认证时给出明确 provider setup 状态；有测试凭据时完成最小 prompt/`agent_settled` 集成测试；
- 正式 macOS artifacts 在对应原生架构完成签名、公证和 smoke。

## 11. 最终判断

Stella v2 的最佳技术方案不是复刻 Multica，也不是把 Pi 示例 subagent 或实验 orchestrator 塞入桌面应用，而是继续当前 ADR 的边界：**Stella 是轻量、持久化、可视化的本地流程控制面；Pi 0.80.10 是固定版本的单节点执行引擎。**

Project/可编辑 Kanban、Catalog、确定性 Team Role、四类节点 DAG、Human Gate、完整 Run snapshot 和每节点独立 RPC 都应保留。实现顺序必须先完成 Phase 0：纯状态机与 stale token、RPC-first cancellation、Windows process-tree cleanup、准确 trust 语义；随后再落地 schema v2 和 React Flow。只有 packaged test 从“能 `get_state`”升级到“能真实 bash、能取消、无遗留进程”，才可以把安装包描述为可在他人 Windows/macOS 上执行 Agent 工作流，而不只是能打开 GUI 的 bundled Pi 前端。

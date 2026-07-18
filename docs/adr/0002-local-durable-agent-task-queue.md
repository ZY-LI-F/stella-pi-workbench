# ADR 0002：在 Electron 主进程持有本地持久化 AgentTask 队列

Stella 以单机、单用户、可直接安装为首要约束，因此先把 PostgreSQL `AgentTaskQueue` 的核心语义——持久化入队、原子认领、单执行者、父子依赖、终态保护和重启恢复——实现到现有原子 JSON Repository，并由 Electron 主进程内的 Runner 调用安装包内置 Pi RPC。它不依赖用户机器上的全局 `pi` 路径，也不要求额外部署 PostgreSQL 或常驻 Daemon。

该选择的直接代价是：应用关闭时不会执行队列、计划或 Webhook；运行中的 AgentTask 会在关闭或下次启动时显式变为 `interrupted`，已排队任务与 `waiting_children` 父任务继续保留。若未来需要无人值守或多机执行，应新增独立服务边界并迁移 Repository，而不是在桌面进程中伪装后台在线。

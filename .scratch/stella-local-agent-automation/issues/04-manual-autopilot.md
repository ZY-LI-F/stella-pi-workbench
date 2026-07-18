# Ticket 04 · Manual Autopilot

Status: DONE  
Blocked by: Ticket 02

## Outcome

用户可保存一个“任务模板 + 执行目标”的手动自动驾驶规则，每次点击都创建独立 Task、审计记录并真实分发。

## Checklist

- [x] 实现 Autopilot 创建、更新、删除与严格输入验证。
- [x] 实现一次原子触发：创建 running audit、fresh Task，并推进分发。
- [x] 成功审计保存 taskId；失败审计保存精确错误且不返回成功。
- [x] typed preload / IPC 暴露 Autopilot CRUD 与 manual trigger。
- [x] Automation Studio 提供规则列表、编辑表单、启停、运行按钮与运行历史。
- [x] 明确显示绑定项目路径与执行目标。
- [x] 添加 Manual trigger、重复运行、disabled/失败测试。
- [x] 运行 typecheck 与相关单测。

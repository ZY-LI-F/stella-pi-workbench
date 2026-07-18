# Ticket 05 · 应用运行期间的 Schedule Autopilot

Status: DONE  
Blocked by: Ticket 04

## Outcome

周期规则只在 Stella 打开时按持久时间戳触发；停机期间的到期被明确记录为 missed，不伪装成后台运行也不制造补跑风暴。

## Checklist

- [x] Schedule trigger 使用正整数 `intervalMinutes` 和持久化 `nextRunAt`。
- [x] 实现可注入 clock/timer 的 ScheduleRunner，逐次重新读取状态。
- [x] 到期后只触发一次并从实际基准推进下一时间。
- [x] 启动发现 elapsed nextRunAt 时写入一个 `missed` audit 并推进到未来。
- [x] disabled/删除/编辑规则不会被旧 timer 触发。
- [x] UI 显示下次时间、应用打开限制和 missed 记录。
- [x] 添加精确时钟、重启、禁用和失败测试。
- [x] 运行 typecheck 与相关单测。

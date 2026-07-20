import { TASK_STAGES, type BoardLane, type ExecutionAcceptanceStatus, type TaskPriority, type TaskStage } from "@shared/kanban";
import type { AgentPresenceState } from "@shared/agent-presence";

export const AGENT_PRESENCE_LABEL: Readonly<Record<AgentPresenceState, string>> = Object.freeze({
  available: "可用",
  queued: "排队",
  running: "执行中",
  waiting: "等待",
  attention: "需处理",
});

export const STAGE_LABEL: Readonly<Record<TaskStage, string>> = Object.freeze({
  planned: "待规划",
  queued: "待运行",
  running: "执行中",
  review: "待审核",
  blocked: "受阻",
  completed: "已完成",
});

export const PRIORITY_LABEL: Readonly<Record<TaskPriority, string>> = Object.freeze({
  low: "低",
  medium: "普通",
  high: "高",
  urgent: "紧急",
});

export const ACCEPTANCE_LABEL: Readonly<Record<ExecutionAcceptanceStatus, string>> = Object.freeze({
  "not-ready": "不可验收",
  pending: "待验收",
  accepted: "已接受",
  "revision-requested": "需修订",
  rejected: "已拒绝",
});

export const EXECUTION_STATUS_LABEL: Readonly<Record<string, string>> = Object.freeze({
  pending: "待执行",
  queued: "排队中",
  running: "执行中",
  waiting: "等待人工",
  succeeded: "已产出",
  review: "人工关卡",
  blocked: "流程受阻",
  waiting_children: "等待子任务",
  waiting_human: "等待用户",
  reported: "已报告",
  failed: "执行失败",
  interrupted: "已中断",
  cancelled: "已取消",
});

// Record<TaskStage, …> 保证新增 stage 时缺失泳道配置会直接编译失败。
const LANE_META: Readonly<Record<TaskStage, { readonly code: string; readonly empty: string }>> = Object.freeze({
  planned: Object.freeze({ code: "PLAN", empty: "把下一项工作放到这里" }),
  queued: Object.freeze({ code: "QUEUE", empty: "暂无等待席位的流程" }),
  running: Object.freeze({ code: "ORBIT", empty: "Agent 运行时会在这里留下星轨" }),
  review: Object.freeze({ code: "GATE", empty: "人工关卡将在这里等待" }),
  blocked: Object.freeze({ code: "HOLD", empty: "失败、中断与阻塞任务" }),
  completed: Object.freeze({ code: "DONE", empty: "验收完成的任务会抵达这里" }),
});

export const LANE_CONFIG: readonly {
  readonly id: BoardLane;
  readonly label: string;
  readonly code: string;
  readonly empty: string;
}[] = Object.freeze(TASK_STAGES.map((stage) => Object.freeze({ id: stage, label: STAGE_LABEL[stage], ...LANE_META[stage] })));

export function formatRelativeTime(dateString: string): string {
  const elapsed = Date.now() - new Date(dateString).getTime();
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Date(dateString).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

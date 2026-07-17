import type { BoardLane, TaskPriority, TaskStatus } from "@shared/kanban";

export const STATUS_LABEL: Readonly<Record<TaskStatus, string>> = Object.freeze({
  planned: "待规划",
  queued: "待运行",
  running: "执行中",
  review: "待审核",
  blocked: "受阻",
  failed: "失败",
  interrupted: "已中断",
  completed: "已完成",
});

export const PRIORITY_LABEL: Readonly<Record<TaskPriority, string>> = Object.freeze({
  low: "低",
  medium: "普通",
  high: "高",
  urgent: "紧急",
});

export const LANE_CONFIG: readonly {
  readonly id: BoardLane;
  readonly label: string;
  readonly code: string;
  readonly empty: string;
}[] = Object.freeze([
  { id: "planned", label: "待规划", code: "PLAN", empty: "把下一项工作放到这里" },
  { id: "queued", label: "待运行", code: "QUEUE", empty: "暂无等待席位的流程" },
  { id: "running", label: "执行中", code: "ORBIT", empty: "Agent 运行时会在这里留下星轨" },
  { id: "review", label: "待审核", code: "GATE", empty: "人工关卡将在这里等待" },
  { id: "blocked", label: "受阻", code: "HOLD", empty: "失败、中断与阻塞任务" },
  { id: "completed", label: "已完成", code: "DONE", empty: "验收完成的任务会抵达这里" },
]);

export function formatRelativeTime(dateString: string): string {
  const elapsed = Date.now() - new Date(dateString).getTime();
  if (elapsed < 60_000) return "刚刚";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return new Date(dateString).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

import type { KanbanTask } from "./kanban";

export type TaskLifecycleEvent =
  | { readonly type: "execution-queued" }
  | { readonly type: "execution-started" }
  | { readonly type: "awaiting-human" }
  | { readonly type: "execution-reported" }
  | { readonly type: "execution-failed"; readonly reason: string }
  | { readonly type: "execution-interrupted"; readonly reason: string }
  | { readonly type: "execution-accepted" }
  | { readonly type: "revision-requested" }
  | { readonly type: "execution-rejected"; readonly reason: string };

export function applyTaskLifecycle(task: KanbanTask, event: TaskLifecycleEvent, now: string): KanbanTask {
  if (Number.isNaN(Date.parse(now))) throw new Error("任务生命周期时间不是有效日期");
  if (event.type === "execution-queued") return Object.freeze({ ...task, stage: "queued", blockedReason: undefined, updatedAt: now });
  if (event.type === "execution-started") return Object.freeze({ ...task, stage: "running", blockedReason: undefined, updatedAt: now });
  if (event.type === "awaiting-human" || event.type === "execution-reported") {
    return Object.freeze({ ...task, stage: "review", blockedReason: undefined, updatedAt: now });
  }
  if (event.type === "execution-accepted") return Object.freeze({ ...task, stage: "completed", blockedReason: undefined, updatedAt: now });
  if (event.type === "revision-requested") return Object.freeze({ ...task, stage: "planned", blockedReason: undefined, updatedAt: now });
  const reason = event.reason.trim();
  if (!reason) throw new Error("受阻任务必须记录原因");
  return Object.freeze({ ...task, stage: "blocked", blockedReason: reason, updatedAt: now });
}

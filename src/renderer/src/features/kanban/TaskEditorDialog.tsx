import { useState, type FormEvent } from "react";
import { Check, Folder, GitBranch, Sparkles } from "lucide-react";
import type { CreateTaskInput, KanbanTask, TaskPriority, UpdateTaskInput, WorkflowDefinition } from "@shared/kanban";
import type { ProjectMeta } from "@shared/contracts";
import { Modal } from "../../components/Modal";

interface TaskEditorDialogProps {
  readonly task?: KanbanTask;
  readonly project: ProjectMeta;
  readonly workflows: readonly WorkflowDefinition[];
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onCreate: (input: CreateTaskInput) => Promise<void>;
  readonly onUpdate: (input: UpdateTaskInput) => Promise<void>;
}

const PRIORITIES: readonly { readonly value: TaskPriority; readonly label: string }[] = Object.freeze([
  { value: "low", label: "低" },
  { value: "medium", label: "普通" },
  { value: "high", label: "高" },
  { value: "urgent", label: "紧急" },
]);

export function TaskEditorDialog({ task, project, workflows, busy, onClose, onCreate, onUpdate }: TaskEditorDialogProps) {
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(task?.acceptanceCriteria ?? "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "medium");
  const [workflowId, setWorkflowId] = useState(task?.workflowId ?? workflows[0]?.id ?? "");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("请填写任务标题");
      return;
    }
    if (!workflowId) {
      setError("请选择流程模板");
      return;
    }
    setError("");
    try {
      if (task) {
        await onUpdate({ taskId: task.id, title, description, acceptanceCriteria, priority, workflowId });
      } else {
        await onCreate({
          title,
          description,
          acceptanceCriteria,
          priority,
          workflowId,
          projectPath: project.cwd,
          projectName: project.name,
          trusted: project.trusted,
        });
      }
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Modal
      title={task ? "编辑任务" : "创建看板任务"}
      eyebrow={task ? "REFINE MISSION" : "NEW MISSION"}
      onClose={onClose}
      className="task-editor"
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="task-editor__project">
          <span><Folder size={14} />{project.name}</span>
          {project.branch && <span><GitBranch size={13} />{project.branch}</span>}
          <small>{task ? "任务项目创建后保持不变" : project.cwd}</small>
        </div>

        <label className="kanban-field">
          <span>任务标题 <i>必填</i></span>
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="清楚描述要交付的结果" />
        </label>

        <label className="kanban-field">
          <span>任务说明</span>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="背景、边界、用户场景与不能破坏的内容" />
        </label>

        <label className="kanban-field">
          <span>验收标准</span>
          <textarea value={acceptanceCriteria} onChange={(event) => setAcceptanceCriteria(event.target.value)} rows={3} placeholder="完成后必须能被验证的条件" />
        </label>

        <div className="task-editor__row">
          <label className="kanban-field">
            <span>优先级</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
              {PRIORITIES.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
            </select>
          </label>
          <div className="kanban-field">
            <span>固定流程</span>
            <div className="workflow-picker">
              {workflows.map((workflow) => (
                <button
                  type="button"
                  className={workflow.id === workflowId ? "is-selected" : ""}
                  key={workflow.id}
                  onClick={() => setWorkflowId(workflow.id)}
                >
                  <span><Sparkles size={13} />{workflow.shortName}</span>
                  <small>{workflow.steps.length} 个步骤</small>
                  {workflow.id === workflowId && <Check size={14} />}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <p className="kanban-form-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="button-secondary" onClick={onClose}>取消</button>
          <button type="submit" className="button-primary" disabled={busy}>{busy ? "保存中…" : task ? "保存任务" : "创建任务"}</button>
        </div>
      </form>
    </Modal>
  );
}

import { FolderCheck, ShieldCheck, ShieldOff } from "lucide-react";
import type { ProjectSelection } from "@shared/contracts";
import { Modal } from "./Modal";

interface ProjectTrustDialogProps {
  readonly project: ProjectSelection;
  readonly onSelect: (trusted: boolean) => void;
  readonly onCancel: () => void;
}
export function ProjectTrustDialog({ project, onSelect, onCancel }: ProjectTrustDialogProps) {
  return (
    <Modal title={`打开 ${project.name}`} eyebrow="PROJECT TRUST" onClose={onCancel} className="trust-dialog">
      <div className="trust-dialog__project"><FolderCheck size={18} /><span><strong>{project.name}</strong><small>{project.path}</small></span></div>
      <p className="trust-dialog__intro">
        这个目录包含项目级 Pi 配置、扩展或技能。请选择它们是否可以在本次工作区中加载。
      </p>
      <div className="trust-options">
        <button type="button" onClick={() => onSelect(true)}>
          <span className="trust-options__icon trust-options__icon--trusted"><ShieldCheck size={20} /></span>
          <span><strong>信任并加载</strong><small>启用项目的 .pi 设置、扩展、技能、提示词与主题。</small></span>
        </button>
        <button type="button" onClick={() => onSelect(false)}>
          <span className="trust-options__icon"><ShieldOff size={20} /></span>
          <span><strong>受限打开</strong><small>只使用用户级资源，忽略项目内可执行扩展与设置。</small></span>
        </button>
      </div>
      <div className="modal-actions"><button type="button" className="button-secondary" onClick={onCancel}>取消</button></div>
    </Modal>
  );
}

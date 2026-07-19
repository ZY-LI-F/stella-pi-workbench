import { useMemo, useState } from "react";
import { AtSign, Bot, GitBranch, Orbit, Send, Sparkles } from "lucide-react";
import type { ProjectMeta } from "@shared/contracts";
import type { AgentPresence } from "@shared/agent-presence";
import type { AgentDefinition } from "@shared/kanban";
import { deriveTeamLaunchDraft, type TeamLaunchDraft } from "@shared/team-launch";
import { AgentMentionInput, type AgentMentionRequest } from "../kanban/AgentMentionInput";
import type { AgentMentionQuery } from "@shared/agent-mentions";

interface TeamLaunchRoomProps {
  readonly project?: ProjectMeta;
  readonly lead?: AgentDefinition;
  readonly presences: readonly AgentPresence[];
  readonly mentionRequest?: AgentMentionRequest;
  readonly busy: boolean;
  readonly executionEnabled: boolean;
  readonly onLaunch: (body: string) => Promise<void>;
}

interface LaunchPreview {
  readonly draft?: TeamLaunchDraft;
  readonly error?: string;
}

export function TeamLaunchRoom({
  project,
  lead,
  presences,
  mentionRequest,
  busy,
  executionEnabled,
  onLaunch,
}: TeamLaunchRoomProps) {
  const [body, setBody] = useState("");
  const [activeQuery, setActiveQuery] = useState<AgentMentionQuery>();
  const [error, setError] = useState("");
  const disabledReason = !project
    ? "请先打开一个项目"
    : !lead
      ? "编排目录缺少通用调度负责人 LEAD"
      : !executionEnabled
        ? "Pi Runtime 尚未就绪，不能启动 LEAD"
        : undefined;
  const preview = useMemo<LaunchPreview>(() => {
    if (!body.trim() || activeQuery) return Object.freeze({});
    try {
      return Object.freeze({ draft: deriveTeamLaunchDraft(body) });
    } catch (cause) {
      return Object.freeze({ error: cause instanceof Error ? cause.message : String(cause) });
    }
  }, [activeQuery, body]);

  const submit = async (): Promise<void> => {
    setError("");
    try {
      deriveTeamLaunchDraft(body);
      await onLaunch(body.trim());
      setBody("");
      setActiveQuery(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className="team-launch-room" aria-label="项目启动室">
      <header className="team-launch-room__header">
        <div><small>ALWAYS-ON ROOM</small><h2>项目启动室</h2></div>
        <span><i />{project?.name ?? "尚未选择项目"}</span>
      </header>

      <div className="team-launch-room__stage">
        <div className="team-launch-room__seed" aria-hidden="true"><i /><b /><span><AtSign size={20} /></span></div>
        <small>MISSION SEED · STELLA RELAY</small>
        <h3>先说目标，再形成任务</h3>
        <p>在这里向 <strong>@LEAD</strong> 描述你想完成的事情。Stella 会把这条消息、任务和 Coordinator 一次写入同一条事实流，然后带你进入新的 Task Room。</p>
        <div className="team-launch-room__relay" aria-label="任务启动顺序">
          <span><b>1</b><small>你说明目标</small></span><i />
          <span><b>2</b><small>LEAD 创建计划</small></span><i />
          <span><b>3</b><small>Worker 接受委派</small></span>
        </div>
        <article className="team-launch-room__lead">
          <span><Bot size={15} /><i /></span>
          <div><strong>通用调度负责人</strong><small>@LEAD · 项目任务入口</small><p>告诉我目标、边界和希望得到的结果。我会先判断是否需要澄清，再拆解、委派并验收真实报告。</p></div>
        </article>
      </div>

      <form className="team-launch-room__composer" aria-label="项目启动室输入器" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="team-launch-room__composer-label"><span><Orbit size={11} />发送启动指令</span><small>只接受一个 @LEAD；直接 Worker 请进入已有 Task Room</small></div>
        <AgentMentionInput
          id="team-launch-message"
          value={body}
          agents={lead ? Object.freeze([lead]) : Object.freeze([])}
          presences={presences}
          mentionRequest={mentionRequest}
          mentionsDisabled={Boolean(disabledReason)}
          mentionsDisabledReason={disabledReason}
          placeholder="@LEAD 说明目标、边界和希望得到的结果…"
          rows={4}
          onChange={(value) => { setBody(value); setError(""); }}
          onQueryChange={setActiveQuery}
          onRequestError={setError}
        />
        <div className={`team-launch-room__impact ${error || preview.error ? "is-error" : preview.draft ? "is-ready" : ""}`} role={error || preview.error ? "alert" : "status"}>
          {error || preview.error
            ? <><AtSign size={12} /><span>{error || preview.error}</span></>
            : activeQuery
              ? <><AtSign size={12} /><span>选择 @LEAD，然后继续写明任务目标。</span></>
              : preview.draft
                ? <><GitBranch size={12} /><span>将创建任务“{preview.draft.title}”，普通优先级，并立即启动 LEAD Coordinator。</span></>
                : <><Sparkles size={12} /><span>消息发送成功后会进入新 Task Room；启动室不保存第二份聊天历史。</span></>}
        </div>
        <footer><span><i />原子写入 Task · Message · Coordinator</span><button type="submit" className="button-primary" disabled={busy || Boolean(disabledReason) || !preview.draft || Boolean(activeQuery)}><Send size={13} />{busy ? "正在建立任务…" : "创建任务并交给 LEAD"}</button></footer>
      </form>
    </section>
  );
}

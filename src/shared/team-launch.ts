import type { TaskPriority } from "./kanban";

const TEAM_LAUNCH_MENTION_PATTERN = /(?:^|\s)@([A-Za-z0-9_-]+)(?=$|\s|[^\p{L}\p{N}_-])/gu;
const LEAD_MENTION_PATTERN = /(^|\s)@lead(?=$|\s|[^\p{L}\p{N}_-])/iu;
const TITLE_LIMIT = 42;

export const TEAM_LAUNCH_ACCEPTANCE_CRITERIA = "LEAD 必须先澄清目标并形成可验证的验收标准；所有 Worker 报告经 LEAD 汇总后由用户最终验收。";

export interface TeamLaunchDraft {
  readonly title: string;
  readonly objective: string;
  readonly acceptanceCriteria: string;
  readonly priority: TaskPriority;
}

function titleFromObjective(objective: string): string {
  const flattened = objective.replace(/\s+/gu, " ").trim();
  const firstSentence = flattened.split(/[。！？!?\r\n]/u)[0]?.trim() || flattened;
  const characters = Array.from(firstSentence);
  return characters.length > TITLE_LIMIT
    ? `${characters.slice(0, TITLE_LIMIT).join("")}…`
    : firstSentence;
}

export function deriveTeamLaunchDraft(body: string): TeamLaunchDraft {
  const message = body.trim();
  if (!message) throw new Error("请先写明要交给团队的任务目标");

  const mentions = [...message.matchAll(TEAM_LAUNCH_MENTION_PATTERN)].map((match) => match[1]?.toLocaleLowerCase()).filter((token): token is string => Boolean(token));
  if (mentions.length === 0) throw new Error("项目启动室需要通过 @LEAD 创建任务");
  const nonLead = mentions.find((token) => token !== "lead");
  if (nonLead) throw new Error(`项目启动室只接受 @LEAD；@${nonLead.toLocaleUpperCase()} 请在已有 Task Room 中使用`);
  if (mentions.length !== 1) throw new Error("每条启动指令只能包含一个 @LEAD");

  const objective = message
    .replace(LEAD_MENTION_PATTERN, "$1")
    .trim()
    .replace(/^[\s:：,，;；\-—]+/u, "")
    .trim();
  if (!objective) throw new Error("请在 @LEAD 后写明任务目标");

  return Object.freeze({
    title: titleFromObjective(objective),
    objective,
    acceptanceCriteria: TEAM_LAUNCH_ACCEPTANCE_CRITERIA,
    priority: "medium",
  });
}

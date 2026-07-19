// @vitest-environment node
import { describe, expect, it } from "vitest";
import { deriveTeamLaunchDraft, TEAM_LAUNCH_ACCEPTANCE_CRITERIA } from "../../src/shared/team-launch";

describe("deriveTeamLaunchDraft", () => {
  it("derives a deterministic title and explicit defaults from one LEAD instruction", () => {
    expect(deriveTeamLaunchDraft("@LEAD 评估 NLRP3 作为帕金森病早研靶点。覆盖临床竞品和关键风险。"))
      .toEqual({
        title: "评估 NLRP3 作为帕金森病早研靶点",
        objective: "评估 NLRP3 作为帕金森病早研靶点。覆盖临床竞品和关键风险。",
        acceptanceCriteria: TEAM_LAUNCH_ACCEPTANCE_CRITERIA,
        priority: "medium",
      });
  });

  it("requires exactly one LEAD and rejects direct Workers in the project launch room", () => {
    expect(() => deriveTeamLaunchDraft("先研究一下这个问题")).toThrow("需要通过 @LEAD");
    expect(() => deriveTeamLaunchDraft("@LEAD")).toThrow("写明任务目标");
    expect(() => deriveTeamLaunchDraft("@BUILD 直接修改项目")).toThrow("只接受 @LEAD");
    expect(() => deriveTeamLaunchDraft("@LEAD 规划后让 @BUILD 开始")).toThrow("只接受 @LEAD");
    expect(() => deriveTeamLaunchDraft("@LEAD 请规划，稍后再问 @LEAD")).toThrow("只能包含一个 @LEAD");
  });

  it("limits long Unicode titles without splitting code points", () => {
    const draft = deriveTeamLaunchDraft(`@LEAD ${"靶点证据".repeat(14)}`);
    expect(Array.from(draft.title).length).toBe(43);
    expect(draft.title.endsWith("…")).toBe(true);
  });
});

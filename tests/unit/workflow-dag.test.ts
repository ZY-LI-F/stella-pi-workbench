import { describe, expect, it } from "vitest";
import type { WorkflowRun } from "../../src/shared/kanban";
import { BUILTIN_ORCHESTRATION_CATALOG } from "../../src/shared/orchestration-catalog";
import { projectWorkflowDag } from "../../src/shared/workflow-dag";

const WORKFLOW = BUILTIN_ORCHESTRATION_CATALOG.workflows.find((workflow) => workflow.steps.length >= 3);
if (!WORKFLOW) throw new Error("测试目录缺少多步骤 Workflow");
const AGENTS = Object.freeze(WORKFLOW.steps.flatMap((step) => step.kind === "agent"
  ? BUILTIN_ORCHESTRATION_CATALOG.agents.filter((agent) => agent.id === step.agentId)
  : []));

function run(): WorkflowRun {
  return Object.freeze({
    id: "run-dag", taskId: "task-1", workflow: WORKFLOW, agents: AGENTS, status: "running", acceptance: "not-ready",
    steps: Object.freeze([
      Object.freeze({ id: "step-run-1", stepId: WORKFLOW.steps[0]?.id ?? "one", stepKind: WORKFLOW.steps[0]?.kind ?? "agent", name: WORKFLOW.steps[0]?.name ?? "一", status: "succeeded", artifact: Object.freeze({ title: "报告", content: "完成" }), sessionPath: "C:/sessions/one.jsonl", startedAt: "2026-07-18T00:00:00.000Z", completedAt: "2026-07-18T00:01:00.000Z" }),
      Object.freeze({ id: "step-run-2", stepId: WORKFLOW.steps[1]?.id ?? "two", stepKind: WORKFLOW.steps[1]?.kind ?? "agent", name: WORKFLOW.steps[1]?.name ?? "二", status: "failed", error: "真实失败", startedAt: "2026-07-18T00:01:00.000Z", completedAt: "2026-07-18T00:02:00.000Z" }),
    ]),
    startedAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:02:00.000Z",
  });
}

describe("projectWorkflowDag", () => {
  it("derives immutable nodes, sequential dependency edges and runtime truth from one persisted snapshot", () => {
    const source = run();
    const projection = projectWorkflowDag(source);
    expect(projection.nodes).toHaveLength(WORKFLOW.steps.length);
    expect(projection.edges).toHaveLength(WORKFLOW.steps.length - 1);
    expect(projection.nodes.map((node) => node.status).slice(0, 3)).toEqual(["succeeded", "failed", "pending"]);
    expect(projection.nodes[0]).toMatchObject({ stepRunId: "step-run-1", artifact: { title: "报告" }, sessionPath: "C:/sessions/one.jsonl" });
    expect(projection.nodes[1]).toMatchObject({ error: "真实失败" });
    expect(projection.edges[0]).toEqual({ id: `edge:step:${WORKFLOW.steps[0]?.id}->step:${WORKFLOW.steps[1]?.id}`, from: `step:${WORKFLOW.steps[0]?.id}`, to: `step:${WORKFLOW.steps[1]?.id}` });
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.nodes)).toBe(true);
    expect(source.steps[0]?.status).toBe("succeeded");
  });

  it("returns an explicit empty graph for a persisted empty Workflow snapshot", () => {
    const source = run();
    const projection = projectWorkflowDag({ ...source, workflow: { ...source.workflow, steps: [] }, steps: [] });
    expect(projection.nodes).toEqual([]);
    expect(projection.edges).toEqual([]);
  });

  it("exposes corrupt duplicate StepRun identity", () => {
    const source = run();
    expect(() => projectWorkflowDag({ ...source, steps: [source.steps[0]!, { ...source.steps[0]!, id: "duplicate" }] }))
      .toThrow(`Workflow Run ${source.id} 含重复 StepRun`);
  });
});

# Stella v4 · Team Relay Implementation Specification

## Outcome

v4 keeps every existing Pi workspace, Kanban, Task Room, Workflow DAG, medical workflow and Autopilot surface, and adds one chat-first team control surface over the same durable Task facts. It does not add a remote backend, PostgreSQL, Redis, a second message store or a second Agent runtime.

## Domain invariants

1. `AgentDefinition` describes a versioned role. It never stores mutable online/busy state.
2. `AgentPresence` is a pure projection from `WorkflowRun`, `StepRun`, `AgentTask` and Task scope. Presence values are `available`, `queued`, `running`, `waiting` and `attention`.
3. A Task stage is changed only by a persisted Stella event or an explicit inactive-task user move:
   - execution created → `queued`
   - Runtime claimed/started → `running`
   - human gate, LEAD question or execution report → `review`
   - failure, interruption, gate rejection or report rejection → `blocked`
   - revision request → `planned`
   - user acceptance → `completed`
4. Model prose cannot mutate a Task stage.
5. Task Room remains the only durable team conversation. Team Chat is a full-screen projection, not another database.
6. Every Worker execution is a real isolated Pi RPC AgentTask with a persisted snapshot, prompt, output, session path, usage, failure and acceptance provenance.

## Team Chat

The left sidebar contains three first-class workspace entries:

- `团队协作`: task channels + full Task Room + Team Pulse;
- `任务看板`: six-lane task supervision and DAG;
- `当前会话`: the complete independent Pi workspace.

Team Chat uses three columns:

1. Task Channels: one channel per Task, searchable and ordered by active/updated state.
2. Collaboration Timeline: the existing `TaskDetailPanel` in full-workspace mode, including DAG, gates, reports, acceptance and composer.
3. Team Pulse: derived Agent state, current Task and workload, plus project Agent creation.

## Mention semantics

- typing `@` opens a visible Agent roster constrained by the selected Task project and optional Squad; the query matches Unicode names, responsibilities, stable callsigns and ids.
- every candidate exposes derived Presence, tool access and required Skills; roster chips and Team Pulse cards insert the same stable `@CALLSIGN` token.
- Arrow Up / Down changes the active option, Enter / Tab inserts it, Escape dismisses the roster, and IME composition never triggers an accidental selection.
- `@worker`: creates a direct or parent/child AgentTask group after an impact preview.
- `@lead`: must be the first Agent mention and creates a `coordinator` root; LEAD and direct Worker mentions are mutually exclusive in one message, in both the renderer and the atomic main-process transaction.
- a normal message while LEAD is `waiting_human`: appends the user message and creates a `coordinator-review` attempt.
- unknown, ambiguous or out-of-project mentions reject the entire transaction.
- no Task Room message is silently converted into a new Kanban Task.

## LEAD structured protocol

LEAD is a read-only built-in Agent. Its final output must be one JSON object with only these fields:

```json
{
  "action": "delegate | request_revision | replan | complete | ask_human",
  "summary": "non-empty decision rationale",
  "delegations": [
    {
      "agentId": "exact available Agent id",
      "objective": "bounded real work",
      "acceptanceCriteria": "verifiable result"
    }
  ],
  "question": "required only for ask_human"
}
```

Validation is strict: unknown fields, prose wrappers, Markdown fences, duplicate/unknown Agent ids or invalid action-specific fields fail the Coordinator attempt and block the Task. There is no natural-language fallback.

After all Worker tasks in a delegation batch report, Stella creates a real `coordinator-review` attempt. LEAD then chooses `complete`, `request_revision`, `replan` or `ask_human`. `complete` still produces only `reported + pending`; the user must accept the report before the Task becomes completed.

## Project AgentDraft

Schema v4 stores `customAgents` in `board.json`. A project Agent contains the normal immutable Agent definition plus `projectPath`, `createdAt` and `updatedAt`.

- Agent id is derived from the validated callsign (`custom-<callsign>`).
- id and callsign must be unique across built-in and project Agents.
- read-only Agent tools are limited to `read`, `grep`, `find`, `ls`.
- write Agents may additionally use `bash`, `edit`, `write`, but the UI requires explicit confirmation.
- required Skills are checked by the existing real Pi RPC preflight.
- project Agents are hidden from and rejected by other project Tasks.
- deleting an Agent is rejected while a Task, Squad or Autopilot still references it; historical AgentTask snapshots remain independently durable.

## Compatibility

- Board schema v1, v2 and v3 are backed up and migrated to v4.
- v3 migration adds an empty `customAgents` collection without rewriting historical execution truth.
- existing Squad output-mention behavior remains available for compatibility.
- fixed Workflows, human gates, DAG snapshots, Autopilot and Pi session continuation retain their existing data paths.

## Verification obligations

- unit tests cover stage transitions, acceptance, restart interruption, project Agent boundaries, Presence projection, strict Coordinator parsing, real Worker creation, LEAD re-entry and invalid prose rejection;
- Electron E2E covers sidebar Team entry, Task Channel selection, Chinese Agent roster search, stable callsign insertion, `@lead` impact preview, AgentDraft creation, Team Pulse one-click insertion, rendering and screenshot capture;
- the existing deterministic and live pharmaceutical E2E suites remain part of regression checks.

---
name: target-assessment-report
description: Synthesize early-discovery biology, tractability, safety, translational, and competitive evidence into a decision-grade target assessment. Use for scored Go, Conditional Go, Hold, or No-Go recommendations and independent evidence audits.
---

# Target Assessment Report

Use only evidence present in the task, upstream artifacts, or cited project files. Surface missing evidence instead of filling it with plausible text.

## Workflow

1. Read [scorecard.md](references/scorecard.md) and [report-template.md](references/report-template.md).
2. Freeze the decision question: target, modality, indication hypothesis, population, and evidence snapshot date.
3. Build a claim-evidence table before scoring. A claim without a resolvable source is an unresolved gap.
4. Score each dimension independently, show arithmetic, and apply the decision rule. Do not average away a critical safety or causal-validation failure.
5. State the strongest falsifier for the recommendation and define the smallest next experiment or data query that can change the decision.
6. For audit tasks, recompute the score, sample-check every decision-changing claim, and separate critical findings from editorial improvements.

## Output Rules

Return decision-grade Markdown with working source links or project evidence paths, dates, explicit unknowns, and a clear indication boundary. This is an R&D prioritization artifact, not medical advice.

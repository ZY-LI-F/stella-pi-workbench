---
name: target-evidence
description: Collect and assess source-backed early-discovery evidence for a human therapeutic target. Use for target identity normalization, human disease association, tissue or cell expression, chemical tractability, and an auditable biology evidence pack.
---

# Target Evidence

Build a dated evidence pack before drawing a target decision. Keep observed facts, database scores, and biological interpretations separate.

## Workflow

1. Normalize the target to approved symbol, Ensembl gene ID, full name, aliases, organism, and protein accession when available. Stop on an identity conflict.
2. From the trusted project root, run:

   `node .pi/skills/target-evidence/scripts/collect-target-evidence.mjs --symbol NLRP3 --ensembl ENSG00000162711 --out evidence/raw/nlrp3-target-evidence.json`

3. Read the saved raw response. Use Open Targets for target identity and disease-association ranking, Human Protein Atlas for tissue/cell expression, and ChEMBL for human target and bioactivity records.
4. Report source URL, retrieval timestamp, identifier, and database-specific caveats for every lane.
5. Grade each statement as direct human evidence, human association, experimental evidence, database annotation, or inference. Never upgrade association to causality.

## Required Output

- Identity table and any alias ambiguity.
- Disease evidence with the database score described as a ranking score, not an effect size.
- Tissue and cell expression relevant to efficacy and on-target safety.
- Chemical/assay evidence and the limits of assay heterogeneity.
- Contradictory evidence, missing lanes, and the next experiment that would resolve each major uncertainty.
- Path to the saved raw evidence file.

Read [evidence-policy.md](references/evidence-policy.md) before assigning evidence strength.

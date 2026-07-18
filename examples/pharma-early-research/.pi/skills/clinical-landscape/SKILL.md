---
name: clinical-landscape
description: Build a current, deduplicated clinical competitor landscape for a therapeutic target. Use for asset, sponsor, indication, phase, recruitment status, termination reason, trial identifier, and differentiation analysis.
---

# Clinical Landscape

Treat the clinical registry as the status ledger and sponsor disclosures as contextual evidence. Never infer that a planned milestone occurred.

## Workflow

1. Define inclusion rules: direct target modulator, human interventional study, named asset, and relevant formulation. Keep pathway-only observational studies separate.
2. Run the registry collector from the trusted project root:

   `node .pi/skills/clinical-landscape/scripts/collect-clinical-landscape.mjs --target NLRP3 --assets dapansutrile,DFV890,VTX3232,VTX2735,selnoflast,NT-0796,VENT-02,ZYIL1,JTE-162 --out evidence/raw/nlrp3-clinical-landscape.json`

3. Read the saved evidence and deduplicate by asset plus trial identifier. Preserve separate trials for different indications.
4. Use ClinicalTrials.gov status and last update date for registry facts. If an official sponsor page supplies a program name, result, or future plan, label it as sponsor-reported and cite the page date.
5. Explicitly report terminated, withdrawn, unknown, and completed-without-posted-results records. Do not silently drop them.

## Required Output

Provide a table with asset, aliases, sponsor, direct/indirect mechanism, CNS penetration claim, indication, phase, status, enrollment, NCT ID, last update, and source. Follow with crowding, first/best-in-class claims that remain unverified, whitespace, and status-change risks.

Read [source-policy.md](references/source-policy.md) before resolving conflicting status claims.

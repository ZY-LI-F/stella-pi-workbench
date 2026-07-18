import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`无效参数：${argv.slice(index).join(" ")}`);
    values.set(key.slice(2), value);
  }
  const symbol = values.get("symbol");
  const ensembl = values.get("ensembl");
  const output = values.get("out");
  if (!symbol || !/^[A-Za-z0-9-]+$/.test(symbol)) throw new Error("--symbol 必须是有效基因符号");
  if (!ensembl || !/^ENSG\d{11}$/.test(ensembl)) throw new Error("--ensembl 必须是有效的人 Ensembl gene ID");
  if (!output) throw new Error("缺少 --out 输出路径");
  return Object.freeze({ symbol, ensembl, output: resolve(output) });
}

async function requestJson(url, init = undefined) {
  const response = await fetch(url, {
    ...init,
    headers: { "user-agent": "stella-pi-target-evidence/1.0", ...init?.headers },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`${url} 未返回有效 JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

async function openTargets(ensembl) {
  const url = "https://api.platform.opentargets.org/api/v4/graphql";
  const query = `query TargetEvidence($ensemblId: String!) {
    target(ensemblId: $ensemblId) {
      id approvedSymbol approvedName biotype
      associatedDiseases(page: { index: 0, size: 25 }) {
        count rows { disease { id name } score }
      }
    }
  }`;
  const response = await requestJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: { ensemblId: ensembl } }),
  });
  if (Array.isArray(response.errors) && response.errors.length > 0) {
    throw new Error(`Open Targets GraphQL 错误: ${JSON.stringify(response.errors)}`);
  }
  if (!response.data?.target) throw new Error(`Open Targets 找不到靶点 ${ensembl}`);
  return Object.freeze({ url, response });
}

async function humanProteinAtlas(ensembl) {
  const url = `https://www.proteinatlas.org/${encodeURIComponent(ensembl)}.json`;
  return Object.freeze({ url, response: await requestJson(url) });
}

async function chembl(symbol) {
  const targetUrl = `https://www.ebi.ac.uk/chembl/api/data/target/search.json?q=${encodeURIComponent(symbol)}&limit=20`;
  const targetResponse = await requestJson(targetUrl);
  const humanTarget = targetResponse.targets?.find((target) => target.organism === "Homo sapiens" && target.target_type === "SINGLE PROTEIN");
  if (!humanTarget?.target_chembl_id) throw new Error(`ChEMBL 找不到 ${symbol} 的人单蛋白靶点`);
  const activityUrl = `https://www.ebi.ac.uk/chembl/api/data/activity.json?target_chembl_id=${encodeURIComponent(humanTarget.target_chembl_id)}&limit=100`;
  const activityResponse = await requestJson(activityUrl);
  return Object.freeze({ targetUrl, activityUrl, targetResponse, activityResponse, targetId: humanTarget.target_chembl_id });
}

const input = parseArguments(process.argv.slice(2));
const snapshotAt = new Date().toISOString();
const [ot, hpa, chemistry] = await Promise.all([
  openTargets(input.ensembl),
  humanProteinAtlas(input.ensembl),
  chembl(input.symbol),
]);
const evidence = Object.freeze({
  schemaVersion: 1,
  snapshotAt,
  query: Object.freeze({ symbol: input.symbol, ensembl: input.ensembl, organism: "Homo sapiens" }),
  sources: Object.freeze({ openTargets: ot, humanProteinAtlas: hpa, chembl: chemistry }),
});
await mkdir(dirname(input.output), { recursive: true });
await writeFile(input.output, `${JSON.stringify(evidence)}\n`, "utf8");

const target = ot.response.data.target;
const summary = Object.freeze({
  ok: true,
  snapshotAt,
  output: input.output,
  identity: Object.freeze({ id: target.id, symbol: target.approvedSymbol, name: target.approvedName, biotype: target.biotype }),
  associatedDiseaseCount: target.associatedDiseases.count,
  topDiseases: Object.freeze(target.associatedDiseases.rows.slice(0, 10)),
  expression: Object.freeze({
    tissueSpecificity: hpa.response["RNA tissue specificity"],
    tissueSpecificNtpm: hpa.response["RNA tissue specific nTPM"],
    cellTypeSpecificity: hpa.response["RNA single cell type specificity"],
    cellTypeSpecificNcpm: hpa.response["RNA single cell type specific nCPM"],
  }),
  chembl: Object.freeze({ targetId: chemistry.targetId, returnedActivities: chemistry.activityResponse.activities?.length ?? 0 }),
});
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

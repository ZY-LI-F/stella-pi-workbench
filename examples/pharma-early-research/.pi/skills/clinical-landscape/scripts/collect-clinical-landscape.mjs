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
  const target = values.get("target");
  const output = values.get("out");
  const assets = (values.get("assets") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!target || !/^[A-Za-z0-9-]+$/.test(target)) throw new Error("--target 必须是有效靶点符号");
  if (!output) throw new Error("缺少 --out 输出路径");
  return Object.freeze({ target, assets: Object.freeze(assets), output: resolve(output) });
}

async function requestJson(url) {
  const response = await fetch(url, { headers: { "user-agent": "stella-pi-clinical-landscape/1.0" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`${url} 未返回有效 JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function normalizeStudy(study) {
  const protocol = study.protocolSection ?? {};
  const identification = protocol.identificationModule ?? {};
  const status = protocol.statusModule ?? {};
  const design = protocol.designModule ?? {};
  const sponsor = protocol.sponsorCollaboratorsModule?.leadSponsor ?? {};
  const interventions = protocol.armsInterventionsModule?.interventions ?? [];
  return Object.freeze({
    nctId: identification.nctId,
    title: identification.briefTitle,
    sponsor: sponsor.name,
    phases: Object.freeze(design.phases ?? []),
    status: status.overallStatus,
    whyStopped: status.whyStopped,
    enrollment: design.enrollmentInfo?.count,
    lastUpdated: status.lastUpdatePostDateStruct?.date,
    interventions: Object.freeze(interventions.map((item) => item.name).filter(Boolean)),
    url: identification.nctId ? `https://clinicaltrials.gov/study/${identification.nctId}` : undefined,
  });
}

const input = parseArguments(process.argv.slice(2));
const terms = Object.freeze([`${input.target} inhibitor`, ...input.assets]);
const params = new URLSearchParams({
  "query.intr": terms.join(" OR "),
  pageSize: "100",
  countTotal: "true",
  format: "json",
  fields: "NCTId,BriefTitle,OverallStatus,Phase,InterventionName,LeadSponsorName,LastUpdatePostDate,WhyStopped,EnrollmentCount",
});
const url = `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`;
const raw = await requestJson(url);
const studies = Object.freeze((raw.studies ?? []).map(normalizeStudy));
const snapshotAt = new Date().toISOString();
const evidence = Object.freeze({ schemaVersion: 1, snapshotAt, query: Object.freeze({ target: input.target, assets: input.assets, terms }), sourceUrl: url, totalCount: raw.totalCount, studies, raw });
await mkdir(dirname(input.output), { recursive: true });
await writeFile(input.output, `${JSON.stringify(evidence)}\n`, "utf8");
const statusCounts = studies.reduce((counts, study) => Object.freeze({ ...counts, [study.status ?? "UNKNOWN"]: (counts[study.status ?? "UNKNOWN"] ?? 0) + 1 }), {});
process.stdout.write(`${JSON.stringify({ ok: true, snapshotAt, output: input.output, totalCount: raw.totalCount, returned: studies.length, statusCounts, studies }, null, 2)}\n`);

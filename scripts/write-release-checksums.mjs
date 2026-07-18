import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const releaseDirectory = join(process.cwd(), "release");
const names = (await readdir(releaseDirectory))
  .filter((name) => /\.(?:exe|dmg|zip)$/u.test(name))
  .sort();
if (names.length === 0) throw new Error(`${releaseDirectory} 中没有 installer artifact`);
const lines = await Promise.all(names.map(async (name) => {
  const digest = createHash("sha256").update(await readFile(join(releaseDirectory, name))).digest("hex").toUpperCase();
  return `${digest}  ${name}`;
}));
await writeFile(join(releaseDirectory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");

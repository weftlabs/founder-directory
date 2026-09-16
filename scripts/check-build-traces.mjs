import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const root = process.cwd();
const traceRoot = resolve(root, ".next");
const traceFiles = [];

function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith(".nft.json")) traceFiles.push(path);
  }
}

collect(traceRoot);
const failures = [];
if (traceFiles.length === 0) failures.push("no Next.js trace manifests found");
for (const traceFile of traceFiles) {
  const trace = JSON.parse(readFileSync(traceFile, "utf8"));
  for (const file of trace.files ?? []) {
    const segments = resolve(join(traceFile, ".."), file).split(sep);
    if (segments.includes(".local")) {
      failures.push(`${relative(root, traceFile)} traces ${file}`);
    }
  }
}

if (failures.length) {
  console.error(
    [
      "Build trace contains ignored local research data:",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(
    `Build trace hygiene passed: ${traceFiles.length} traces contain no .local files.`,
  );
}

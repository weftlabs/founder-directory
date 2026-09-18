// Layer: CLI. Private file checkpoints for an explicit, bounded TypeSafe experiment.
import { mkdir, open, realpath } from "node:fs/promises";
import { resolve, dirname, relative, sep } from "node:path";
import {
  parseInput,
  runPoc,
  renderReport,
  type Run,
} from "../lib/typesafe-poc";

import {
  parseFounderInput,
  runFounderPoc,
  renderFounderReport,
  type FounderRun,
} from "../lib/typesafe-founder-poc";

async function main() {
  const args = process.argv.slice(2);
  let input: string | undefined;
  let output: string | undefined;
  let live = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--live" && !live) live = true;
    else if (
      args[i] === "--input" &&
      !input &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      input = args[++i];
    else if (
      args[i] === "--output" &&
      !output &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      output = args[++i];
    else throw new Error("invalid_arguments");
  }
  if (!input || !output || !output.endsWith(".json"))
    throw new Error("input_and_json_output_required");
  const local = resolve(".local");
  const outputPath = resolve(output);
  const rel = relative(local, outputPath);
  if (
    !rel ||
    rel.startsWith(`..${sep}`) ||
    rel === ".." ||
    resolve(local, rel) !== outputPath
  )
    throw new Error("output_must_be_in_local");
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const realLocal = await realpath(local);
  const realParent = await realpath(dirname(outputPath));
  const parentRel = relative(realLocal, realParent);
  if (
    parentRel === ".." ||
    parentRel.startsWith(`..${sep}`) ||
    realLocal !== local
  )
    throw new Error("output_symlink_forbidden");
  const inputFile = await open(input, "r");
  let data;
  try {
    if ((await inputFile.stat()).size > 1_000_000)
      throw new Error("input_too_large");
    const raw: unknown = JSON.parse(await inputFile.readFile("utf8"));
    data =
      raw && typeof raw === "object" && "kind" in raw && raw.kind === "founder"
        ? parseFounderInput(raw)
        : parseInput(raw);
  } finally {
    await inputFile.close();
  }
  // Exclusively reserve both paths before a paid request. A second invocation cannot repeat a run.
  const json = await open(outputPath, "wx", 0o600);
  let html;
  try {
    html = await open(outputPath.replace(/\.json$/, ".html"), "wx", 0o600);
  } catch {
    await json.close();
    throw new Error("report_path_exists");
  }
  const checkpoint = async (run: Run | FounderRun) => {
    for (const [file, body] of [
      [json, JSON.stringify(run, null, 2) + "\n"],
      [
        html,
        run.schema === "typesafe-founder-poc-result-v1"
          ? renderFounderReport(run)
          : renderReport(run),
      ],
    ] as const) {
      await file.write(body, 0, "utf8");
      await file.truncate(Buffer.byteLength(body));
      await file.sync();
    }
  };
  try {
    const options = {
      live,
      apiKey: live
        ? process.env.TYPESAFE_AI_API_KEY ||
          process.env.TYPESAGE_AI_API_KEY ||
          process.env.TYPESAFE_API_KEY
        : undefined,
      checkpoint,
    };
    const run =
      "kind" in data
        ? await runFounderPoc(data, options)
        : await runPoc(data, options);
    console.log(
      `TypeSafe ${run.mode}: ${run.status}; ${run.summary.callsAttempted} calls attempted. Private JSON and HTML saved.`,
    );
    if (run.status === "failed") process.exitCode = 1;
  } finally {
    await json.close();
    await html.close();
  }
}
// Never print input, provider errors, request bodies, paths or credentials.
main().catch(() => {
  console.error(
    "TypeSafe POC stopped. Check arguments, private output paths and key availability. Existing output is never overwritten; do not repeat an ambiguous live call.",
  );
  process.exitCode = 1;
});

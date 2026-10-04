// Explicit operator entry point. No environment files or production defaults.
import { open } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { postgresDatabase, type Database } from "../lib/enrichment/db";
import {
  parsePreparationManifest,
  planPreparationManifest,
  planFounderConnectionBatches,
  prepareFounderDnaRelease,
  prepareFounderConnections,
  validateConnectionOptions,
  type ConnectionOptions,
} from "../lib/enrichment/dna-prepare";
import { stableDigest } from "../lib/enrichment/contracts";
import { parseConnectionBatchManifest } from "../lib/enrichment/founder-connections";
import { generationRoute } from "../lib/enrichment/generation";
import {
  boundedWeftClient,
  WORKER_WEFT_TIMEOUT_MS,
} from "../lib/enrichment/runtime";
import type { WeftTransport } from "../lib/weft";

const HELP = `Founder DNA source release preparation (no environment files are loaded)
  cohort-plan --database-url URL --release ID --scope NAME --members PRIVATE_MEMBERS.json --file PRIVATE_COHORT.json --confirm-write
  prepare --database-url URL --file PRIVATE_COHORT.json --confirm-write
  connections-plan --database-url URL --release ID --scope NAME --file PRIVATE_BATCHES.json --confirm-write
  connections --database-url URL --release ID --scope NAME --policy POLICY.json --budget UUID (--jev-cap-micros INTEGER | --judge-model PROVIDER:MODEL --max-cost USD) --max-requests INTEGER [--batch-file PRIVATE_BATCHES.json --batch UUID] [--mode replay|acquire] [--allow-paid] --confirm-write

Pass --database-url explicitly; database environment variables are never used.
Cohort-plan derives analysis IDs from a frozen entity set and current eligible portrait approvals.
Prepare reads that generated cohort, stages 1–1000 profiles and can resume unchanged work.
Connections defaults to replay (no network). Acquire also requires --allow-paid and
ENRICHMENT_ALLOW_PAID=1. Jev acquire also requires TYPESAFE_AI_API_KEY
(or TYPESAGE_AI_API_KEY/TYPESAFE_API_KEY). --judge-model PROVIDER:MODEL uses a chat
model instead: WEFT_API_KEY, --policy for that route, --budget and --max-cost; no TypeSafe key.
Acquire requires one immutable manifest batch. Each batch contains at most 25 pairs.
Batch runs retain decisions but do not stage links; run full replay with the same manifest to stage globally.
Replay without a manifest can inspect retained decisions but cannot stage links.
The request limit bounds all candidate decisions, including cached decisions.
The existing scope budget caps total reservations; --jev-cap-micros caps each Jev request.
--max-cost caps each chat-judge request. --jev-cap-micros is not used with --judge-model.
Neither command approves, validates, exports or activates a release. See docs/founder-dna-prepare.md.
`;

async function jsonFile(path: string): Promise<unknown> {
  const file = await open(path, "r");
  try {
    if ((await file.stat()).size > 1_000_000)
      throw new Error("operator_file_too_large");
    return JSON.parse(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}
async function writeJsonExclusive(path: string, value: unknown) {
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    await file.close();
  }
}
type Dependencies = {
  env?: Record<string, string | undefined>;
  connect?: (url: string) => Database & { close(): Promise<void> };
  fetcher?: typeof fetch;
  weft?: WeftTransport;
  output?: (text: string) => void;
};
function parseJudgeModel(spec: string) {
  const [provider, ...modelParts] = spec.split(":");
  const model = modelParts.join(":");
  if (!provider || !model) throw new Error("invalid_judge_model");
  generationRoute(provider);
  return { provider, model, revision: null };
}
export async function main(
  args = process.argv.slice(2),
  dependencies: Dependencies = {},
) {
  const output = dependencies.output ?? console.log;
  const command = args[0];
  if (!command || command === "--help" || command === "help") {
    output(HELP);
    return;
  }
  if (
    command !== "cohort-plan" &&
    command !== "prepare" &&
    command !== "connections-plan" &&
    command !== "connections"
  )
    throw new Error("unknown_command");
  const { values } = parseArgs({
    args: args.slice(1),
    options: {
      "database-url": { type: "string" },
      file: { type: "string" },
      members: { type: "string" },
      release: { type: "string" },
      scope: { type: "string" },
      policy: { type: "string" },
      budget: { type: "string" },
      mode: { type: "string", default: "replay" },
      "jev-cap-micros": { type: "string" },
      "max-requests": { type: "string" },
      "judge-model": { type: "string" },
      "max-cost": { type: "string" },
      "batch-file": { type: "string" },
      batch: { type: "string" },
      "allow-paid": { type: "boolean" },
      "confirm-write": { type: "boolean" },
    },
  });
  if (!values["confirm-write"])
    throw new Error("explicit_write_confirmation_required");
  const env = dependencies.env ?? process.env;
  const apiKey =
    env.TYPESAFE_AI_API_KEY || env.TYPESAGE_AI_API_KEY || env.TYPESAFE_API_KEY;
  const judgeModel =
    command === "connections" && values["judge-model"]
      ? parseJudgeModel(values["judge-model"])
      : undefined;
  if (command === "connections" && judgeModel && !values["max-cost"]?.trim())
    throw new Error("missing --max-cost");
  if (command === "connections" && values.mode === "acquire") {
    const paid =
      values["allow-paid"] === true && env.ENRICHMENT_ALLOW_PAID === "1";
    const credential = judgeModel ? env.WEFT_API_KEY : apiKey;
    if (!paid || !credential) throw new Error("paid_connections_not_enabled");
  }
  if (!values["database-url"])
    throw new Error("explicit_database_url_required");
  const required = (key: keyof typeof values) => {
    const value = values[key];
    if (typeof value !== "string" || !value.trim())
      throw new Error(`missing --${key}`);
    return value;
  };
  const manifest =
    command === "prepare"
      ? parsePreparationManifest(await jsonFile(required("file")))
      : undefined;
  const cohortSelection =
    command === "cohort-plan" ? await jsonFile(required("members")) : undefined;
  const batchManifest =
    command === "connections" && values["batch-file"]
      ? parseConnectionBatchManifest(await jsonFile(required("batch-file")))
      : undefined;
  const connections: ConnectionOptions | undefined =
    command === "connections"
      ? {
          releaseId: required("release"),
          scope: required("scope"),
          budgetId: required("budget"),
          capMicros: judgeModel ? "1" : required("jev-cap-micros"),
          maxRequests: Number(required("max-requests")),
          mode: required("mode") as ConnectionOptions["mode"],
          policy: (await jsonFile(
            required("policy"),
          )) as ConnectionOptions["policy"],
          batchManifest,
          batchId: values.batch,
          ...(judgeModel
            ? { judgeModel, maxCostUsd: required("max-cost") }
            : {}),
        }
      : undefined;
  if (connections) validateConnectionOptions(connections);
  const db = (dependencies.connect ?? postgresDatabase)(values["database-url"]);
  try {
    let result: unknown;
    if (command === "cohort-plan") {
      const plan = await planPreparationManifest(
        db,
        required("release"),
        required("scope"),
        cohortSelection,
      );
      await writeJsonExclusive(required("file"), plan);
      result = {
        releaseId: plan.releaseId,
        profiles: plan.profiles.length,
        manifestHash: stableDigest(plan),
      };
    } else if (manifest) result = await prepareFounderDnaRelease(db, manifest);
    else if (command === "connections-plan") {
      const plan = await planFounderConnectionBatches(
        db,
        required("release"),
        required("scope"),
      );
      await writeJsonExclusive(required("file"), plan);
      result = {
        releaseId: plan.releaseId,
        candidatePairs: plan.candidateCount,
        batches: plan.batches.map((batch) => ({
          id: batch.id,
          index: batch.index,
          pairs: batch.pairIds.length,
        })),
      };
    } else
      result = await prepareFounderConnections(db, connections!, {
        enabled: () =>
          values["allow-paid"] === true && env.ENRICHMENT_ALLOW_PAID === "1",
        apiKey,
        fetcher: dependencies.fetcher,
        weft: judgeModel
          ? (dependencies.weft ??
            (env.WEFT_API_KEY
              ? boundedWeftClient(env.WEFT_API_KEY, WORKER_WEFT_TIMEOUT_MS)
              : {
                  fetch: async () => {
                    throw new Error("missing_weft_key");
                  },
                }))
          : undefined,
      });
    output(JSON.stringify(result));
  } finally {
    await db.close();
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    // Provider/DB/file errors can contain credentials or private evidence.
    console.error(
      "Founder DNA preparation failed; inspect the private input and retained attempt state before retrying.",
    );
    process.exitCode = 1;
  });
}

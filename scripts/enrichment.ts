import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { postgresDatabase, migrateEnrichment } from "../lib/enrichment/db";
import { EnrichmentStore } from "../lib/enrichment/store";
import {
  installLegacyIntake,
  importLegacyIntake,
} from "../lib/enrichment/legacy";
import { runAnalysis } from "../lib/enrichment/analysis";
import { weftGeneration, generationRoute } from "../lib/enrichment/generation";
import { boundedWeftClient } from "../lib/enrichment/runtime";
import type { AnalysisInput } from "../lib/enrichment/contracts";
import type { CollectionInput } from "../lib/enrichment/collection";
import {
  buildWorkerManifest,
  createStageHandlers,
  type WorkerConfiguration,
} from "../lib/enrichment/worker";
import { WorkerStore } from "../lib/enrichment/worker-store";
import { runPendingStages } from "../lib/enrichment/pipeline";
import {
  workerAdapters,
  type WorkerTransportConfig,
} from "../lib/enrichment/worker-runtime";

const HELP = `Enrichment operator commands (no environment files are loaded)
  inventory
  migrate --confirm-write
  release-template --file WORKER_CONFIG.json
  evaluation-import --file EVALUATION.json --batch NAME --confirm-write
  release-create --file MANIFEST.json --confirm-write
  release-approve --id UUID --evaluation UUID --actor NAME --reason TEXT --confirm-write
  release-promote --scope NAME --id UUID --reason TEXT --confirm-write
  intake --scope NAME [--limit 100] --confirm-write
  budget-create --scope NAME --cap-micros INTEGER --confirm-write
  analyze --file INPUT.json --policy POLICY.json --budget UUID --max-cost USD --allow-paid --confirm-write
  worker --file WORKER_CONFIG.json --scope NAME --mode acquire|rederive [--limit 25] [--lease-seconds 900] --allow-paid --confirm-write
  publish --id ANALYSIS_UUID --confirm-write

Set ENRICHMENT_DATABASE_URL explicitly. This tool never falls back to DATABASE_URL.
Release-template reads configuration and prints a manifest; no database or paid calls.
Migrate installs additive tables and a no-spend intake trigger on an existing founders table.
Analyze uses saved evidence in INPUT.json. It never recollects sources.
Paid model calls also require WEFT_API_KEY and ENRICHMENT_ALLOW_PAID=1.
Approval requires a saved evaluation artifact; no default release is auto-approved.
Worker imports bounded intake, reconciles durable targets and processes at most --limit stages.
Re-derive never collects sources; model and embedding calls still need a budget.
`;

function argument(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`missing ${name}`);
  return value;
}

async function jsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

type WorkerFile = {
  configuration: WorkerConfiguration;
  transport: WorkerTransportConfig;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function workerFile(
  path: string,
  requireTransport: boolean,
): Promise<WorkerFile> {
  const value = await jsonFile<unknown>(path);
  if (!record(value) || !record(value.configuration))
    throw new Error("invalid_worker_configuration");
  const configuration = value.configuration;
  if (
    !nonempty(configuration.codeDigest) ||
    !record(configuration.model) ||
    !nonempty(configuration.model.provider) ||
    !nonempty(configuration.model.model) ||
    !(
      configuration.model.revision === null ||
      nonempty(configuration.model.revision)
    )
  )
    throw new Error("invalid_worker_model_configuration");
  generationRoute(configuration.model.provider);
  if (
    configuration.website !== undefined &&
    (!record(configuration.website) ||
      !["exa", "jina"].includes(String(configuration.website.provider)) ||
      (configuration.website.maxExcerptChars !== undefined &&
        (!Number.isSafeInteger(configuration.website.maxExcerptChars) ||
          Number(configuration.website.maxExcerptChars) < 1 ||
          Number(configuration.website.maxExcerptChars) > 100000)))
  )
    throw new Error("invalid_worker_website_configuration");
  if (
    configuration.embedding !== undefined &&
    (!record(configuration.embedding) ||
      !nonempty(configuration.embedding.model) ||
      !nonempty(configuration.embedding.modelVersion) ||
      !Number.isSafeInteger(configuration.embedding.dimensions) ||
      Number(configuration.embedding.dimensions) < 1)
  )
    throw new Error("invalid_worker_embedding_configuration");
  if (requireTransport) {
    const transport = value.transport;
    if (
      !record(transport) ||
      !nonempty(transport.scope) ||
      !nonempty(transport.budgetId) ||
      !Number.isSafeInteger(transport.generation) ||
      Number(transport.generation) < 0 ||
      !record(transport.policies) ||
      !nonempty(transport.sourceMaxCostUsd) ||
      !nonempty(transport.modelMaxCostUsd)
    )
      throw new Error("invalid_worker_transport_configuration");
    if (
      configuration.website !== undefined &&
      !nonempty(transport.websiteMaxCostUsd)
    )
      throw new Error("invalid_website_cap_configuration");
    if (
      record(configuration.website) &&
      configuration.website.provider === "jina" &&
      transport.websiteMaxCostUsd !== "0"
    )
      throw new Error("jina_requires_zero_cap");
    if (
      transport.embeddingEndpoint !== undefined &&
      (!record(transport.embeddingEndpoint) ||
        !nonempty(transport.embeddingEndpoint.url) ||
        !nonempty(transport.embeddingEndpoint.operationId) ||
        !nonempty(transport.embeddingEndpoint.accessMethodId) ||
        !nonempty(transport.embeddingEndpoint.maxCostUsd) ||
        typeof transport.embeddingEndpoint.includeDimensions !== "boolean")
    )
      throw new Error("invalid_embedding_endpoint_configuration");
  }
  return value as unknown as WorkerFile;
}

function boundedInteger(
  args: string[],
  name: string,
  fallback: number,
  maximum: number,
): number {
  const result = args.includes(name) ? Number(argument(args, name)) : fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
    throw new Error(`invalid_${name.slice(2)}`);
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (!command || command === "--help" || command === "help") {
    console.log(HELP);
    return;
  }
  if (command === "release-template") {
    const file = await workerFile(argument(args, "--file"), false);
    console.log(
      JSON.stringify(buildWorkerManifest(file.configuration), null, 2),
    );
    return;
  }
  if (
    ![
      "inventory",
      "migrate",
      "evaluation-import",
      "release-create",
      "release-approve",
      "release-promote",
      "intake",
      "budget-create",
      "analyze",
      "worker",
      "publish",
    ].includes(command)
  )
    throw new Error("unknown_command");
  if (command !== "inventory" && !args.includes("--confirm-write"))
    throw new Error("explicit_write_confirmation_required");
  let worker:
    | {
        file: WorkerFile;
        scope: string;
        mode: "acquire" | "rederive";
        limit: number;
        leaseSeconds: number;
      }
    | undefined;
  if (command === "worker") {
    if (
      !args.includes("--allow-paid") ||
      process.env.ENRICHMENT_ALLOW_PAID !== "1" ||
      !process.env.WEFT_API_KEY
    )
      throw new Error("paid_worker_not_enabled");
    const mode = argument(args, "--mode");
    if (mode !== "acquire" && mode !== "rederive")
      throw new Error("invalid_worker_mode");
    const file = await workerFile(argument(args, "--file"), true);
    const scope = argument(args, "--scope");
    if (file.transport.scope !== scope)
      throw new Error("worker_scope_mismatch");
    worker = {
      file,
      scope,
      mode,
      limit: boundedInteger(args, "--limit", 25, 1000),
      leaseSeconds: boundedInteger(args, "--lease-seconds", 900, 3600),
    };
  }
  const connection = process.env.ENRICHMENT_DATABASE_URL;
  if (!connection) throw new Error("ENRICHMENT_DATABASE_URL_required");
  const db = postgresDatabase(connection);
  const store = new EnrichmentStore(db);
  try {
    switch (command) {
      case "inventory": {
        const result = await db.query(
          "SELECT (SELECT count(*) FROM enrichment_entities) AS entities, (SELECT count(*) FROM enrichment_artifacts) AS artifacts, (SELECT coalesce(sum(byte_length),0) FROM enrichment_artifacts) AS artifact_bytes, (SELECT count(*) FROM enrichment_analysis_runs) AS analyses, (SELECT count(*) FROM enrichment_founder_intake WHERE imported_at IS NULL) AS pending_intake",
        );
        const coverage = await db.query(
          "SELECT release_id,stage,status,count(*) AS count FROM enrichment_stage_work GROUP BY release_id,stage,status ORDER BY release_id,stage,status",
        );
        console.log(
          JSON.stringify({ ...result.rows[0], coverage: coverage.rows }),
        );
        break;
      }
      case "migrate":
        await migrateEnrichment(db);
        await installLegacyIntake(db);
        console.log("Additive migrations applied; no source or model calls.");
        break;
      case "release-create":
        console.log(
          await store.createRelease(await jsonFile(argument(args, "--file"))),
        );
        break;
      case "evaluation-import": {
        const evaluation = await jsonFile<unknown>(argument(args, "--file"));
        if (
          !record(evaluation) ||
          !nonempty(evaluation.rubricVersion) ||
          !nonempty(evaluation.reviewer) ||
          !Array.isArray(evaluation.caseResults) ||
          !evaluation.caseResults.length ||
          typeof evaluation.passed !== "boolean"
        )
          throw new Error("invalid_evaluation_record");
        const artifact = await store.putArtifact({
          kind: "legacy_import",
          body: Buffer.from(JSON.stringify(evaluation)),
          contentType: "application/json",
          redactionVersion: "operator-evaluation-v1",
          importBatch: argument(args, "--batch"),
          metadata: { purpose: "release_evaluation", source: "operator_file" },
        });
        console.log(artifact.id);
        break;
      }
      case "release-approve":
        await store.approveRelease(
          argument(args, "--id"),
          argument(args, "--evaluation"),
          {
            actor: argument(args, "--actor"),
            reason: argument(args, "--reason"),
          },
        );
        console.log("Release approved; intake target unchanged.");
        break;
      case "release-promote":
        console.log(
          await store.promoteRelease(
            argument(args, "--scope"),
            argument(args, "--id"),
            argument(args, "--reason"),
          ),
        );
        break;
      case "intake":
        console.log(
          JSON.stringify(
            await importLegacyIntake(
              db,
              argument(args, "--scope"),
              args.includes("--limit")
                ? Number(argument(args, "--limit"))
                : 100,
            ),
          ),
        );
        break;
      case "budget-create": {
        const id = randomUUID();
        await store.createBudget({
          id,
          scope: argument(args, "--scope"),
          currency: "USD",
          capMicros: argument(args, "--cap-micros"),
        });
        console.log(id);
        break;
      }
      case "analyze": {
        if (
          !args.includes("--allow-paid") ||
          process.env.ENRICHMENT_ALLOW_PAID !== "1" ||
          !process.env.WEFT_API_KEY
        )
          throw new Error("paid_analysis_not_enabled");
        const input = await jsonFile<AnalysisInput>(argument(args, "--file"));
        const policy = await jsonFile<CollectionInput["policy"]>(
          argument(args, "--policy"),
        );
        const execute = weftGeneration(
          store,
          boundedWeftClient(process.env.WEFT_API_KEY),
          {
            scope: policy.scope,
            budgetId: argument(args, "--budget"),
            maxCostUsd: argument(args, "--max-cost"),
            policy,
            enabled: () => process.env.ENRICHMENT_ALLOW_PAID === "1",
          },
        );
        const result = await runAnalysis(store, input, execute);
        console.log(
          JSON.stringify({ status: result.status, runId: result.runId }),
        );
        break;
      }
      case "worker": {
        if (!worker) throw new Error("worker_configuration_missing");
        const intake = await importLegacyIntake(db, worker.scope, worker.limit);
        // Intake also reconciles targets. Repeating the worker after a crash resumes that durable intent.
        const adapters = workerAdapters(
          store,
          boundedWeftClient(process.env.WEFT_API_KEY!),
          worker.file.transport,
          () => process.env.ENRICHMENT_ALLOW_PAID === "1",
          worker.file.configuration.model.provider,
        );
        const handlers = createStageHandlers(store, new WorkerStore(db), {
          ...worker.file.configuration,
          mode: worker.mode,
          ...adapters,
        });
        const scope = worker.scope;
        const result = await runPendingStages(
          {
            claimStage: (leaseSeconds) => store.claimStage(leaseSeconds, scope),
            finishStage: (outcome) => store.finishStage(outcome),
          },
          handlers,
          { limit: worker.limit, leaseSeconds: worker.leaseSeconds },
        );
        console.log(
          JSON.stringify({
            scope,
            mode: worker.mode,
            imported: intake.imported,
            ...result,
          }),
        );
        break;
      }
      case "publish":
        console.log(
          JSON.stringify({
            published: await store.publishAnalysis(argument(args, "--id")),
          }),
        );
        break;
    }
  } finally {
    await db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch(() => {
    console.error(
      "Enrichment command failed. Check explicit arguments, database state and policy; no automatic retry was made.",
    );
    process.exitCode = 1;
  });
}

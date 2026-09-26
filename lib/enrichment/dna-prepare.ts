// Layer: operator orchestration. Assemble releases only from approved retained results.
import "../assert-server";
import type { Database } from "./db";
import type { CollectionInput } from "./collection";
import { DnaPublicationStore } from "./dna-store";
import { EnrichmentStore } from "./store";
import {
  assertConnectionEndpointsEligible,
  loadConnectionEndpoints,
} from "./dna-connections-data";
import {
  assertConnectionBatchManifest,
  buildConnectionRequest,
  createConnectionBatchManifest,
  discoverFounderConnections,
  rankConnectionCandidates,
  resolveConnectionBatch,
  type ConnectionBatchManifest,
} from "./founder-connections";
import { retainedJev } from "./retained-jev";

export type PreparationManifest = {
  version: 1;
  releaseId: string;
  scope: string;
  profiles: {
    entityId: string;
    analysisId: string;
    portraitAnalysisId: string;
  }[];
};
export type FrozenCohortSelection = {
  version: 1;
  entityIds: string[];
};
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function label(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(value)
  );
}
function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  );
}
export function parsePreparationManifest(value: unknown): PreparationManifest {
  if (
    !record(value) ||
    Object.keys(value).sort().join() !== "profiles,releaseId,scope,version" ||
    value.version !== 1 ||
    !label(value.releaseId) ||
    !label(value.scope) ||
    !Array.isArray(value.profiles) ||
    !value.profiles.length ||
    value.profiles.length > 1000
  )
    throw new Error("invalid_preparation_manifest");
  const profiles = value.profiles
    .map((row) => {
      if (
        !record(row) ||
        Object.keys(row).sort().join() !==
          "analysisId,entityId,portraitAnalysisId" ||
        !uuid(row.entityId) ||
        !uuid(row.analysisId) ||
        !uuid(row.portraitAnalysisId)
      )
        throw new Error("invalid_preparation_profile");
      return {
        entityId: row.entityId.toLowerCase(),
        analysisId: row.analysisId.toLowerCase(),
        portraitAnalysisId: row.portraitAnalysisId.toLowerCase(),
      };
    })
    .sort((a, b) => a.entityId.localeCompare(b.entityId));
  if (new Set(profiles.map((p) => p.entityId)).size !== profiles.length)
    throw new Error("duplicate_preparation_entity");
  return {
    version: 1,
    releaseId: value.releaseId,
    scope: value.scope,
    profiles,
  };
}
export function parseFrozenCohortSelection(
  value: unknown,
): FrozenCohortSelection {
  if (
    !record(value) ||
    Object.keys(value).sort().join() !== "entityIds,version" ||
    value.version !== 1 ||
    !Array.isArray(value.entityIds) ||
    !value.entityIds.length ||
    value.entityIds.length > 1000 ||
    value.entityIds.some((id) => !uuid(id))
  )
    throw new Error("invalid_frozen_cohort_selection");
  const entityIds = value.entityIds.map((id) => id.toLowerCase()).sort();
  if (new Set(entityIds).size !== entityIds.length)
    throw new Error("duplicate_frozen_cohort_entity");
  return { version: 1, entityIds };
}

export async function planPreparationManifest(
  db: Database,
  releaseId: string,
  scope: string,
  input: unknown,
): Promise<PreparationManifest> {
  if (!label(releaseId) || !label(scope))
    throw new Error("invalid_preparation_manifest_identity");
  const selection = parseFrozenCohortSelection(input);
  const profiles = (
    await db.query<{
      entityId: string;
      analysisId: string;
      portraitAnalysisId: string;
    }>(
      `SELECT entity_id AS "entityId",analysis_id AS "analysisId",portrait_analysis_id AS "portraitAnalysisId"
       FROM founder_dna_eligible_portrait_publications
       WHERE entity_id=ANY($1::uuid[]) ORDER BY entity_id`,
      [selection.entityIds],
    )
  ).rows;
  if (
    profiles.length !== selection.entityIds.length ||
    profiles.some(
      (profile, index) => profile.entityId !== selection.entityIds[index],
    )
  )
    throw new Error("cohort_selection_incomplete_or_ineligible");
  return parsePreparationManifest({
    version: 1,
    releaseId,
    scope,
    profiles,
  });
}

export async function prepareFounderDnaRelease(db: Database, input: unknown) {
  const manifest = parsePreparationManifest(input);
  const store = new DnaPublicationStore(db);
  await store.createRelease({
    id: manifest.releaseId,
    manifest,
    expectedProfiles: manifest.profiles.length,
  });
  for (const profile of manifest.profiles)
    await store.stageProfile({ releaseId: manifest.releaseId, ...profile });
  return {
    releaseId: manifest.releaseId,
    stagedProfiles: manifest.profiles.length,
  };
}

export type ConnectionOptions = {
  releaseId: string;
  scope: string;
  budgetId: string;
  capMicros: string;
  maxRequests: number;
  mode: "acquire" | "replay";
  policy: CollectionInput["policy"];
  batchManifest?: ConnectionBatchManifest;
  batchId?: string;
};
export function validateConnectionOptions(input: ConnectionOptions) {
  const policy = input.policy;
  if (
    !label(input.releaseId) ||
    !label(input.scope) ||
    !uuid(input.budgetId) ||
    !/^[1-9][0-9]{0,17}$/.test(input.capMicros) ||
    !Number.isSafeInteger(input.maxRequests) ||
    input.maxRequests < 1 ||
    input.maxRequests > 5000 ||
    !["acquire", "replay"].includes(input.mode) ||
    (!!input.batchId && !input.batchManifest) ||
    (input.mode === "acquire" && (!input.batchManifest || !input.batchId))
  )
    throw new Error("invalid_connection_options");
  if (
    !record(policy) ||
    !label(policy.id) ||
    policy.scope !== input.scope ||
    policy.operation !== "typesafe-systemone" ||
    policy.storageVerified !== true ||
    policy.retentionApproved !== true
  )
    throw new Error("connection_policy_not_approved");
}

async function loadReleaseCohort(
  db: Database,
  releaseId: string,
  scope: string,
) {
  const release = (
    await db.query<{ manifest: unknown; expected: number; total: number }>(
      `SELECT r.manifest,r.expected_profiles AS expected,
    (SELECT count(*)::integer FROM founder_dna_release_profiles p WHERE p.release_id=r.id) AS total
    FROM founder_dna_releases r WHERE r.id=$1 AND r.status='staging'`,
      [releaseId],
    )
  ).rows[0];
  if (!release) throw new Error("release_not_staging");
  const manifest = parsePreparationManifest(release.manifest);
  if (
    manifest.releaseId !== releaseId ||
    manifest.scope !== scope ||
    manifest.profiles.length !== release.expected ||
    release.total !== release.expected
  )
    throw new Error("connection_release_scope_or_cohort_mismatch");
  const endpoints = await loadConnectionEndpoints(db, releaseId);
  const approved = new Map(
    manifest.profiles.map((profile) => [profile.entityId, profile.analysisId]),
  );
  if (
    endpoints.some(
      (endpoint) => approved.get(endpoint.entityId) !== endpoint.analysisId,
    )
  )
    throw new Error("connection_release_scope_or_cohort_mismatch");
  return { endpoints, pairs: rankConnectionCandidates(endpoints) };
}

export async function planFounderConnectionBatches(
  db: Database,
  releaseId: string,
  scope: string,
) {
  if (!label(releaseId) || !label(scope))
    throw new Error("invalid_connection_batch_plan");
  const { pairs } = await loadReleaseCohort(db, releaseId, scope);
  if (pairs.length > 5000) throw new Error("connection_request_limit_exceeded");
  pairs.forEach((pair) => buildConnectionRequest(pair));
  return createConnectionBatchManifest(releaseId, scope, pairs);
}

export async function prepareFounderConnections(
  db: Database,
  input: ConnectionOptions,
  transport: {
    enabled: () => boolean;
    apiKey?: string;
    fetcher?: typeof fetch;
  },
) {
  validateConnectionOptions(input);
  const cohort = await loadReleaseCohort(db, input.releaseId, input.scope);
  if (cohort.pairs.length > input.maxRequests)
    throw new Error("connection_request_limit_exceeded");
  if (input.batchManifest)
    assertConnectionBatchManifest(
      input.batchManifest,
      input.releaseId,
      input.scope,
      cohort.pairs,
    );
  const batch =
    input.batchManifest && input.batchId
      ? resolveConnectionBatch(
          input.batchManifest,
          input.releaseId,
          input.scope,
          cohort.pairs,
          input.batchId,
        )
      : undefined;
  if (
    !(
      await db.query(
        "SELECT id FROM enrichment_budgets WHERE id=$1 AND scope=$2 AND currency='USD'",
        [input.budgetId, input.scope],
      )
    ).rows.length
  )
    throw new Error("connection_budget_scope_mismatch");
  const publication = new DnaPublicationStore(db);
  const execute = retainedJev(new EnrichmentStore(db), {
    ...input,
    ...transport,
  });
  let requests = 0;
  return discoverFounderConnections({
    loadEndpoints: async () => {
      const current = await loadReleaseCohort(db, input.releaseId, input.scope);
      if (current.pairs.length > input.maxRequests)
        throw new Error("connection_request_limit_exceeded");
      if (
        input.batchManifest &&
        stableBatchMismatch(
          input.batchManifest,
          input.releaseId,
          input.scope,
          current.pairs,
        )
      )
        throw new Error("connection_batch_manifest_mismatch");
      return current.endpoints;
    },
    pairIds: batch?.pairIds,
    stageConnections: !!input.batchManifest && !batch,
    assertEligible: (pair) =>
      assertConnectionEndpointsEligible(db, input.releaseId, pair),
    execute: async (request) => {
      if (++requests > input.maxRequests)
        throw new Error("connection_request_limit_exceeded");
      return execute(request);
    },
    saveDecision: (decision) => publication.saveConnectionDecision(decision),
    stageDecision: (id) => publication.stageConnection(input.releaseId, id),
  });
}

function stableBatchMismatch(
  manifest: ConnectionBatchManifest,
  releaseId: string,
  scope: string,
  pairs: ReturnType<typeof rankConnectionCandidates>,
) {
  try {
    assertConnectionBatchManifest(manifest, releaseId, scope, pairs);
    return false;
  } catch {
    return true;
  }
}

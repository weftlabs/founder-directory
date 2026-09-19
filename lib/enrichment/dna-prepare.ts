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
  discoverFounderConnections,
  rankConnectionCandidates,
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
    !["acquire", "replay"].includes(input.mode)
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
  const release = (
    await db.query<{ manifest: unknown; expected: number; total: number }>(
      `SELECT r.manifest,r.expected_profiles AS expected,
    (SELECT count(*)::integer FROM founder_dna_release_profiles p WHERE p.release_id=r.id) AS total
    FROM founder_dna_releases r WHERE r.id=$1 AND r.status='staging'`,
      [input.releaseId],
    )
  ).rows[0];
  if (!release) throw new Error("release_not_staging");
  const manifest = parsePreparationManifest(release.manifest);
  if (
    manifest.releaseId !== input.releaseId ||
    manifest.scope !== input.scope ||
    manifest.profiles.length !== release.expected ||
    release.total !== release.expected
  )
    throw new Error("connection_release_scope_or_cohort_mismatch");
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
      const endpoints = await loadConnectionEndpoints(db, input.releaseId);
      const approved = new Map(
        manifest.profiles.map((p) => [p.entityId, p.analysisId]),
      );
      if (endpoints.some((e) => approved.get(e.entityId) !== e.analysisId))
        throw new Error("connection_release_scope_or_cohort_mismatch");
      if (rankConnectionCandidates(endpoints).length > input.maxRequests)
        throw new Error("connection_request_limit_exceeded");
      return endpoints;
    },
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

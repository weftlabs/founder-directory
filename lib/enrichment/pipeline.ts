// Layer: domain. Owns bounded campaign planning and coverage; persistence owns atomic claims.
import { stableDigest } from "./contracts";

export const STAGES = [
  "collection",
  "extraction",
  "product_discovery",
  "product_descriptions",
  "founder_dna",
  "embeddings",
] as const;
export type Stage = (typeof STAGES)[number];
export type StageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "not_applicable"
  | "unavailable"
  | "blocked"
  | "failed"
  | "cancelled";

export function campaignManifest(founderIds: readonly string[]) {
  if (founderIds.some((id) => !id)) throw new Error("invalid_campaign_member");
  const members = Object.freeze([...new Set(founderIds)].sort());
  return { members, digest: stableDigest(members) };
}

export interface StageCoverage {
  stage: Stage;
  status: StageStatus;
  evidenceIds: readonly string[];
}

export function processingCoverage(
  rows: readonly StageCoverage[],
  required: readonly Stage[] = STAGES,
) {
  const complete = (row: StageCoverage) =>
    row.status === "succeeded" ||
    (row.status === "not_applicable" && row.evidenceIds.length > 0);
  const all = required.every(
    (stage) =>
      rows.some((row) => row.stage === stage) &&
      rows.filter((row) => row.stage === stage).every(complete),
  );
  const status = all
    ? "fully_analyzed"
    : rows.some((row) =>
          ["failed", "blocked", "cancelled"].includes(row.status),
        )
      ? "failed_blocked"
      : rows.some(
            (row) =>
              complete(row) ||
              row.status === "unavailable" ||
              row.status === "not_applicable",
          )
        ? "partial"
        : "pending";
  return {
    status,
    completedStages: required.filter(
      (stage) =>
        rows.some((row) => row.stage === stage) &&
        rows.filter((row) => row.stage === stage).every(complete),
    ).length,
    requiredStages: required.length,
  };
}

export function planStages(input: {
  recipes: Record<string, string>;
  inputDigests: Record<string, string>;
  saved: readonly {
    stage: Stage;
    recipeDigest: string;
    inputDigest: string;
    status: StageStatus;
    outputId: string;
  }[];
}) {
  return STAGES.map((stage) => {
    const recipeDigest = input.recipes[stage];
    const inputDigest = input.inputDigests[stage];
    if (!recipeDigest || !inputDigest)
      return { stage, action: "missing_input" as const, outputId: null };
    const saved = input.saved.find(
      (row) =>
        row.stage === stage &&
        row.status === "succeeded" &&
        row.recipeDigest === recipeDigest &&
        row.inputDigest === inputDigest,
    );
    return {
      stage,
      action: saved ? ("reuse" as const) : ("run" as const),
      outputId: saved?.outputId ?? null,
    };
  });
}

/** Advisory precheck only; the persistence transaction MUST repeat these guards under lock. */
export function canPublish(
  candidate: {
    entityId: string;
    releaseId: string;
    generation: number;
    validated: boolean;
  },
  target: {
    entityId: string;
    releaseId: string;
    generation: number;
    suppressed: boolean;
  },
  releaseStatus: string,
): boolean {
  return (
    candidate.validated &&
    !target.suppressed &&
    releaseStatus === "approved" &&
    candidate.entityId === target.entityId &&
    candidate.releaseId === target.releaseId &&
    candidate.generation === target.generation
  );
}

export interface ClaimedStage {
  id: string;
  leaseToken: string;
  entityId: string;
  releaseId: string;
  generation: number;
  stage: string;
}

export interface StageOutcome {
  status: Exclude<StageStatus, "pending" | "running">;
  reason?: string;
  evidenceId?: string;
  outputId?: string;
}

export interface PipelineStore {
  /** Atomic lease claim: only active entities with completed dependencies are eligible. */
  claimStage(leaseSeconds: number): Promise<ClaimedStage | null>;
  finishStage(
    input: StageOutcome & { id: string; leaseToken: string },
  ): Promise<void>;
}

/** Serial and bounded. Only persistence can claim work or commit a lease-owned result.
 * Adapter handlers must honor bounded I/O timeouts below their lease and the paid ledger.
 * An interrupted dispatch is uncertain in that ledger; this runner never retries it.
 */
export async function runPendingStages(
  store: PipelineStore,
  handlers: Partial<
    Record<Stage, (work: ClaimedStage) => Promise<StageOutcome>>
  >,
  options: { limit: number; leaseSeconds: number },
) {
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 1000 ||
    !Number.isSafeInteger(options.leaseSeconds) ||
    options.leaseSeconds < 1 ||
    options.leaseSeconds > 3600
  )
    throw new Error("invalid_worker_limits");
  const counts: Partial<Record<StageOutcome["status"], number>> = {};
  let processed = 0;
  while (processed < options.limit) {
    const work = await store.claimStage(options.leaseSeconds);
    if (!work) break;
    const handler = STAGES.includes(work.stage as Stage)
      ? handlers[work.stage as Stage]
      : undefined;
    let outcome: StageOutcome;
    if (!handler)
      outcome = { status: "blocked", reason: "stage_handler_not_configured" };
    else {
      try {
        outcome = await handler(work);
        if (
          outcome.status === "not_applicable" &&
          (!outcome.evidenceId || !outcome.reason)
        )
          outcome = {
            status: "blocked",
            reason: "not_applicable_requires_evidence_and_reason",
          };
      } catch {
        // Do not copy arbitrary provider errors: they can contain credentials or source data.
        outcome = {
          status: "failed",
          reason: "stage_handler_failed_inspect_attempt_ledger",
        };
      }
    }
    // Lease loss must escape. A worker cannot report an outcome it failed to commit.
    await store.finishStage({
      ...outcome,
      id: work.id,
      leaseToken: work.leaseToken,
    });
    counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
    processed++;
  }
  return { processed, counts };
}

// Separate portrait publication and atomic data-release selection over retained analyses.
import "../assert-server";
import type { Database, Sql } from "./db";
import { stableDigest } from "./contracts";
import {
  parseFounderDnaProfile,
  FOUNDER_DNA_SCHEMA_VERSION,
  type FounderDnaProfile,
} from "../founder-dna";
export const DNA_CODE_VERSION = "founder-dna-v1";
export type ConnectionDecisionInput = {
  id: string;
  leftEntityId: string;
  rightEntityId: string;
  leftAnalysisId: string;
  rightAnalysisId: string;
  relation: "related_work";
  recipeVersion: string;
  model: string;
  candidateMethod: string;
  state: "accepted" | "rejected" | "insufficient";
  reason: string;
  leftEvidenceIds: string[];
  rightEvidenceIds: string[];
  requestArtifactId: string;
  responseArtifactId: string;
};
async function eligibleCount(tx: Sql, releaseId: string) {
  return (
    await tx.query<{
      total: number;
      eligible: number;
      expected: number;
      edges: number;
      eligibleEdges: number;
    }>(
      `SELECT r.expected_profiles AS expected,
  (SELECT count(*)::integer FROM founder_dna_release_profiles p WHERE p.release_id=r.id) AS total,
  (SELECT count(*)::integer FROM founder_dna_eligible_profiles p WHERE p.release_id=r.id) AS eligible,
  (SELECT count(*)::integer FROM founder_dna_release_edges e WHERE e.release_id=r.id) AS edges,
  (SELECT count(*)::integer FROM founder_dna_eligible_edges e WHERE e.release_id=r.id) AS "eligibleEdges"
  FROM founder_dna_releases r WHERE r.id=$1`,
      [releaseId],
    )
  ).rows[0];
}
export class DnaPublicationStore {
  constructor(readonly db: Database) {}
  async createRelease(input: {
    id: string;
    manifest: unknown;
    expectedProfiles: number;
    codeVersion?: string;
  }) {
    if (
      !input.id ||
      input.id.length > 120 ||
      !Number.isSafeInteger(input.expectedProfiles) ||
      input.expectedProfiles < 1 ||
      input.expectedProfiles > 1000 ||
      (input.codeVersion && input.codeVersion !== DNA_CODE_VERSION)
    )
      throw new Error("invalid_dna_release");
    const hash = stableDigest(input.manifest);
    await this.db.query(
      "INSERT INTO founder_dna_releases(id,schema_version,code_version,manifest,manifest_hash,expected_profiles) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING",
      [
        input.id,
        FOUNDER_DNA_SCHEMA_VERSION,
        DNA_CODE_VERSION,
        JSON.stringify(input.manifest),
        hash,
        input.expectedProfiles,
      ],
    );
    const { rows } = await this.db.query(
      "SELECT id FROM founder_dna_releases WHERE id=$1 AND manifest_hash=$2 AND expected_profiles=$3 AND code_version=$4",
      [input.id, hash, input.expectedProfiles, DNA_CODE_VERSION],
    );
    if (!rows.length) throw new Error("dna_release_identity_conflict");
  }
  async approvePortrait(
    entityId: string,
    analysisId: string,
    approvedBy: string,
  ) {
    if (!approvedBy.trim()) throw new Error("portrait_approval_required");
    const { rows } = await this.db.query(
      `INSERT INTO founder_dna_portrait_publications(entity_id,analysis_id,approved_by)
      SELECT a.entity_id,a.id,$3 FROM enrichment_eligible_analyses a JOIN enrichment_releases r ON r.id=a.release_id AND r.status='approved'
      WHERE a.id=$2 AND a.entity_id=$1 AND a.purpose='founder_portrait' AND a.status='succeeded' AND founder_dna_sources_eligible(a.evidence_ids)
      ON CONFLICT(entity_id) DO UPDATE SET analysis_id=EXCLUDED.analysis_id,approved_by=EXCLUDED.approved_by,updated_at=now()
      WHERE (SELECT created_at FROM enrichment_analysis_runs WHERE id=EXCLUDED.analysis_id)>=(SELECT created_at FROM enrichment_analysis_runs WHERE id=founder_dna_portrait_publications.analysis_id) RETURNING entity_id`,
      [entityId, analysisId, approvedBy],
    );
    if (!rows.length)
      throw new Error("portrait_not_eligible_or_newer_publication_exists");
  }
  async stageProfile(input: {
    releaseId: string;
    entityId: string;
    analysisId: string;
    portraitAnalysisId: string;
  }): Promise<FounderDnaProfile> {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      const row = (
        await tx.query<{ output: { profile: unknown } }>(
          `SELECT a.output FROM enrichment_eligible_analyses a
      JOIN founder_dna_portrait_publications p ON p.entity_id=a.entity_id AND p.analysis_id=a.id
      JOIN founder_dna_releases r ON r.id=$1 AND r.status='staging'
      WHERE a.id=$2 AND a.entity_id=$3 AND a.purpose='founder_portrait' AND a.status='succeeded'`,
          [input.releaseId, input.portraitAnalysisId, input.entityId],
        )
      ).rows[0];
      if (!row) throw new Error("portrait_not_approved_or_release_frozen");
      const stored = parseFounderDnaProfile(row.output.profile);
      if (
        stored.id !== input.entityId ||
        stored.analysisId !== input.analysisId ||
        stored.portrait.analysisId !== input.portraitAnalysisId
      )
        throw new Error("portrait_identity_mismatch");
      const profile = parseFounderDnaProfile({
        ...stored,
        releaseId: input.releaseId,
        connections: [],
      });
      const hash = stableDigest(profile);
      await tx.query(
        "INSERT INTO founder_dna_release_profiles(release_id,entity_id,analysis_id,portrait_analysis_id,profile,profile_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(release_id,entity_id) DO NOTHING",
        [
          input.releaseId,
          input.entityId,
          input.analysisId,
          input.portraitAnalysisId,
          JSON.stringify(profile),
          hash,
        ],
      );
      const result = await tx.query(
        "SELECT entity_id FROM founder_dna_eligible_profiles WHERE release_id=$1 AND entity_id=$2 AND profile_hash=$3",
        [input.releaseId, input.entityId, hash],
      );
      if (!result.rows.length)
        throw new Error("profile_ineligible_or_conflicting");
      return profile;
    });
  }
  async saveConnectionDecision(input: ConnectionDecisionInput) {
    if (
      input.leftEntityId === input.rightEntityId ||
      input.relation !== "related_work" ||
      !["accepted", "rejected", "insufficient"].includes(input.state) ||
      !input.reason ||
      input.reason.length > 400 ||
      !input.leftEvidenceIds.length ||
      !input.rightEvidenceIds.length ||
      input.leftEvidenceIds.length > 12 ||
      input.rightEvidenceIds.length > 12
    )
      throw new Error("invalid_connection_decision");
    const values = [
      input.id,
      input.leftEntityId,
      input.rightEntityId,
      input.leftAnalysisId,
      input.rightAnalysisId,
      input.relation,
      input.recipeVersion,
      input.model,
      input.candidateMethod,
      input.state,
      input.reason,
      JSON.stringify(input.leftEvidenceIds),
      JSON.stringify(input.rightEvidenceIds),
      input.requestArtifactId,
      input.responseArtifactId,
    ];
    await this.db.transaction(async (tx) => {
      for (const [entity, analysis, evidence] of [
        [input.leftEntityId, input.leftAnalysisId, input.leftEvidenceIds],
        [input.rightEntityId, input.rightAnalysisId, input.rightEvidenceIds],
      ] as const) {
        const ok = await tx.query(
          "SELECT id FROM enrichment_eligible_analyses WHERE id=$1 AND entity_id=$2 AND status='succeeded' AND evidence_ids @> $3::jsonb AND founder_dna_sources_eligible($3::jsonb)",
          [analysis, entity, JSON.stringify(evidence)],
        );
        if (!ok.rows.length) throw new Error("connection_endpoint_ineligible");
      }
      const old = (
        await tx.query<{ fingerprint: string }>(
          "SELECT md5(row_to_json(d)::text) AS fingerprint FROM founder_dna_connection_decisions d WHERE id=$1",
          [input.id],
        )
      ).rows[0];
      if (old) {
        const match = await tx.query(
          "SELECT id FROM founder_dna_connection_decisions WHERE id=$1 AND left_entity_id=$2 AND right_entity_id=$3 AND left_analysis_id=$4 AND right_analysis_id=$5 AND relation=$6 AND recipe_version=$7 AND model=$8 AND candidate_method=$9 AND state=$10 AND reason=$11 AND left_evidence_ids=$12::jsonb AND right_evidence_ids=$13::jsonb AND request_artifact_id=$14 AND response_artifact_id=$15",
          values,
        );
        if (!match.rows.length) throw new Error("connection_identity_conflict");
        return;
      }
      await tx.query(
        "INSERT INTO founder_dna_connection_decisions(id,left_entity_id,right_entity_id,left_analysis_id,right_analysis_id,relation,recipe_version,model,candidate_method,state,reason,left_evidence_ids,right_evidence_ids,request_artifact_id,response_artifact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
        values,
      );
    });
  }
  async stageConnection(releaseId: string, decisionId: string) {
    await this.db.transaction(async (tx) => {
      const release = await tx.query(
        "SELECT id FROM founder_dna_releases WHERE id=$1 AND status='staging' FOR UPDATE",
        [releaseId],
      );
      if (!release.rows.length) throw new Error("release_not_staging");
      await tx.query(
        "INSERT INTO founder_dna_release_edges(release_id,decision_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [releaseId, decisionId],
      );
      if (
        !(
          await tx.query(
            "SELECT id FROM founder_dna_eligible_edges WHERE release_id=$1 AND id=$2",
            [releaseId, decisionId],
          )
        ).rows.length
      )
        throw new Error("connection_not_eligible");
    });
  }
  private async validate(tx: Sql, releaseId: string) {
    const counts = await eligibleCount(tx, releaseId);
    if (
      !counts ||
      counts.total !== counts.expected ||
      counts.eligible !== counts.total ||
      counts.edges !== counts.eligibleEdges
    )
      throw new Error("dna_release_incomplete_or_ineligible");
    for (const row of (
      await tx.query<{ profile: unknown; profile_hash: string }>(
        "SELECT profile,profile_hash FROM founder_dna_release_profiles WHERE release_id=$1",
        [releaseId],
      )
    ).rows) {
      if (
        stableDigest(parseFounderDnaProfile(row.profile)) !== row.profile_hash
      )
        throw new Error("dna_profile_hash_mismatch");
    }
    return counts;
  }
  async validateRelease(releaseId: string) {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      const counts = await this.validate(tx, releaseId);
      await tx.query(
        "UPDATE founder_dna_releases SET status='validated' WHERE id=$1",
        [releaseId],
      );
      return counts;
    });
  }
  async activateRelease(releaseId: string) {
    await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(73422002)");
      if (
        !(
          await tx.query(
            "SELECT id FROM founder_dna_releases WHERE id=$1 AND status='validated' AND schema_version=$2 AND code_version=$3",
            [releaseId, FOUNDER_DNA_SCHEMA_VERSION, DNA_CODE_VERSION],
          )
        ).rows.length
      )
        throw new Error("release_not_validated");
      await this.validate(tx, releaseId);
      await tx.query(
        "INSERT INTO founder_dna_active_release(singleton,release_id) VALUES(true,$1) ON CONFLICT(singleton) DO UPDATE SET previous_release_id=founder_dna_active_release.release_id,release_id=EXCLUDED.release_id,activated_at=now() WHERE founder_dna_active_release.release_id<>EXCLUDED.release_id",
        [releaseId],
      );
    });
  }
  async rollback() {
    const previous = (
      await this.db.query<{ previous_release_id: string | null }>(
        "SELECT previous_release_id FROM founder_dna_active_release WHERE singleton=true",
      )
    ).rows[0]?.previous_release_id;
    if (!previous) throw new Error("no_previous_dna_release");
    await this.activateRelease(previous);
  }
}

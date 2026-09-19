// Private candidate reads. Never serialize these vectors or retained source texts to a client.
import "../assert-server";
import type { Sql } from "./db";
import { stableDigest } from "./contracts";
export type ConnectionEndpointRecord = {
  entityId: string;
  analysisId: string;
  sourceRevision: string;
  eligible: true;
  evidence: {
    id: string;
    entityId: string;
    text: string;
    contentHash: string;
    sourceUrl: string;
  }[];
  embedding: {
    scope: string;
    text: string;
    templateVersion: string;
    model: string;
    modelVersion: string;
    dimensions: number;
    distance: "cosine" | "euclidean" | "dot";
    vector: number[];
  };
};
export async function loadConnectionEndpoints(
  db: Sql,
  releaseId: string,
): Promise<ConnectionEndpointRecord[]> {
  const rows = (
    await db.query<{
      entityId: string;
      analysisId: string;
      sourceRevision: string;
      evidenceIds: string[];
      embedding: ConnectionEndpointRecord["embedding"];
    }>(
      `SELECT DISTINCT ON(p.entity_id) p.entity_id AS "entityId",p.analysis_id AS "analysisId",p.profile->>'sourceRevision' AS "sourceRevision",
  (SELECT jsonb_agg(s->>'id') FROM jsonb_array_elements(p.profile->'sources') s) AS "evidenceIds",
  jsonb_build_object('scope',v.scope,'text',v.input_text,'templateVersion',v.template_version,'model',v.model,'modelVersion',v.model_version,'dimensions',v.dimensions,'distance',v.distance,'vector',to_jsonb(v.vector)) AS embedding
  FROM founder_dna_eligible_profiles p JOIN enrichment_analysis_embeddings link ON link.entity_id=p.entity_id AND link.analysis_id=p.analysis_id AND link.purpose='founder_dna'
  JOIN enrichment_embeddings v ON v.id=link.embedding_id WHERE p.release_id=$1 ORDER BY p.entity_id,v.id LIMIT 1000`,
      [releaseId],
    )
  ).rows;
  const output: ConnectionEndpointRecord[] = [];
  for (const row of rows) {
    const evidence = (
      await db.query<{ id: string; text: string; sourceUrl: string }>(
        `SELECT DISTINCT e.id,e.excerpt AS text,e.source_url AS "sourceUrl" FROM enrichment_evidence e
    JOIN enrichment_entity_evidence own ON own.evidence_id=e.id AND own.entity_id=$1 WHERE e.id=ANY($2::uuid[]) AND e.purged_at IS NULL AND e.source_url IS NOT NULL AND founder_dna_sources_eligible(jsonb_build_array(e.id::text)) ORDER BY e.id`,
        [row.entityId, row.evidenceIds],
      )
    ).rows;
    if (!evidence.length || evidence.length !== row.evidenceIds.length)
      continue;
    output.push({
      entityId: row.entityId,
      analysisId: row.analysisId,
      sourceRevision: row.sourceRevision,
      eligible: true,
      embedding: row.embedding,
      evidence: evidence.map((e) => ({
        ...e,
        entityId: row.entityId,
        contentHash: stableDigest(e.text),
      })),
    });
  }
  return output;
}
export async function assertConnectionEndpointsEligible(
  db: Sql,
  releaseId: string,
  pair: {
    left: Pick<
      ConnectionEndpointRecord,
      "entityId" | "analysisId" | "sourceRevision"
    >;
    right: Pick<
      ConnectionEndpointRecord,
      "entityId" | "analysisId" | "sourceRevision"
    >;
  },
) {
  if (pair.left.entityId === pair.right.entityId)
    throw new Error("connection_self_pair");
  for (const endpoint of [pair.left, pair.right]) {
    const { rows } = await db.query(
      "SELECT entity_id FROM founder_dna_eligible_profiles WHERE release_id=$1 AND entity_id=$2 AND analysis_id=$3 AND profile->>'sourceRevision'=$4",
      [
        releaseId,
        endpoint.entityId,
        endpoint.analysisId,
        endpoint.sourceRevision,
      ],
    );
    if (!rows.length)
      throw new Error("connection_endpoint_changed_or_ineligible");
  }
}

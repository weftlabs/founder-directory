-- Derive candidate cohorts from eligible approvals and preview validated releases without activation.
CREATE VIEW founder_dna_eligible_portrait_publications AS
SELECT publication.entity_id,
 dna.id AS analysis_id,
 portrait.id AS portrait_analysis_id
FROM founder_dna_portrait_publications publication
JOIN enrichment_entities entity ON entity.id=publication.entity_id AND entity.kind='founder' AND entity.status='active'
JOIN enrichment_eligible_analyses portrait ON portrait.id=publication.analysis_id AND portrait.entity_id=publication.entity_id AND portrait.purpose='founder_portrait' AND portrait.status='succeeded'
JOIN enrichment_releases portrait_release ON portrait_release.id=portrait.release_id AND portrait_release.status='approved'
JOIN enrichment_eligible_analyses dna ON dna.id::text=portrait.output->'profile'->>'analysisId' AND dna.entity_id=publication.entity_id AND dna.purpose='founder_dna' AND dna.status='succeeded'
JOIN enrichment_releases dna_release ON dna_release.id=dna.release_id AND dna_release.status='approved'
WHERE founder_dna_sources_eligible(dna.evidence_ids)
AND founder_dna_sources_eligible(portrait.evidence_ids)
AND founder_dna_sources_eligible(coalesce((SELECT jsonb_agg(source->>'id') FROM jsonb_array_elements(portrait.output->'profile'->'sources') source),'[]'::jsonb))
AND portrait.output->'profile'->>'id'=publication.entity_id::text
AND lower(portrait.output->'profile'->>'handle')=lower(entity.legacy_key)
AND portrait.output->'profile'->>'analysisId'=dna.id::text
AND portrait.output->'profile'->'portrait'->>'analysisId'=portrait.id::text
AND portrait.validation_report->>'checksPassed'='true'
AND NOT EXISTS(
  SELECT 1
  FROM jsonb_array_elements_text(jsonb_build_array(
    portrait.validation_report->>'generationResponseArtifactId',
    portrait.validation_report->>'judgeRequestArtifactId',
    portrait.validation_report->>'judgeResponseArtifactId'
  )) needed(id)
  WHERE needed.id IS NULL OR NOT EXISTS(
    SELECT 1 FROM enrichment_artifacts retained
    WHERE retained.id::text=needed.id AND retained.purged_at IS NULL
    AND (retained.expires_at IS NULL OR retained.expires_at>now())
    AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals withdrawal WHERE withdrawal.artifact_id=retained.id)
  )
)
AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements_text(coalesce(portrait.validation_report->'productAnalysisIds','[]'::jsonb)) product(id)
  WHERE NOT EXISTS(
    SELECT 1 FROM enrichment_eligible_analyses product_analysis
    JOIN enrichment_releases product_release ON product_release.id=product_analysis.release_id AND product_release.status='approved'
    JOIN enrichment_founder_products relation ON relation.product_id=product_analysis.entity_id AND relation.founder_id=publication.entity_id
    WHERE product_analysis.id::text=product.id AND product_analysis.purpose='product_descriptions' AND product_analysis.status='succeeded'
    AND founder_dna_sources_eligible(product_analysis.evidence_ids)
    AND founder_dna_sources_eligible(jsonb_build_array(relation.evidence_id::text))
  )
)
AND ((portrait.validation_report->>'judgeRecipeVersion' IS DISTINCT FROM 'cited-founder-portrait-judge-v5'
  AND portrait.validation_report->>'judgeRecipeVersion' IS DISTINCT FROM 'cited-founder-portrait-judge-v6') OR (
  jsonb_typeof(portrait.validation_report->'judgeExchanges')='array'
  AND jsonb_array_length(CASE WHEN jsonb_typeof(portrait.validation_report->'judgeExchanges')='array' THEN portrait.validation_report->'judgeExchanges' ELSE '[]'::jsonb END) BETWEEN 1 AND 15
  AND NOT EXISTS(
    SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(portrait.validation_report->'judgeExchanges')='array' THEN portrait.validation_report->'judgeExchanges' ELSE '[]'::jsonb END) exchange
    CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_build_array(exchange->>'requestArtifactId',exchange->>'responseArtifactId')) needed(id)
    WHERE needed.id IS NULL OR NOT EXISTS(
      SELECT 1 FROM enrichment_artifacts retained
      WHERE retained.id::text=needed.id AND retained.purged_at IS NULL
      AND (retained.expires_at IS NULL OR retained.expires_at>now())
      AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals withdrawal WHERE withdrawal.artifact_id=retained.id)
    )
  )
));

CREATE FUNCTION founder_dna_release_profile_reads(selected_release text)
RETURNS TABLE(handle text,status text,profile jsonb)
LANGUAGE sql STABLE AS $$
SELECT lower(entity.legacy_key) AS handle,
 CASE WHEN eligible.entity_id IS NULL THEN 'hidden' ELSE 'ready' END AS status,
 staged.profile || jsonb_build_object('connections',coalesce((
   SELECT jsonb_agg(item ORDER BY edge_id) FROM (
     SELECT decision.id AS edge_id,
       jsonb_build_object(
         'id',decision.id,'relation',decision.relation,'reason',decision.reason,
         'founder',jsonb_build_object(
           'id',other.entity_id,'handle',other.profile->>'handle','name',other.profile->>'name',
           'avatarUrl',other.profile->'avatarUrl','headline',other.profile->'portrait'->'archetype'->>'hook',
           'revision',other.profile->>'revision'
         ),
         'sourceIds',decision.left_evidence_ids||decision.right_evidence_ids,
         'sources',(SELECT jsonb_agg(DISTINCT source) FROM jsonb_array_elements((staged.profile->'sources')||(other.profile->'sources')) source
           WHERE decision.left_evidence_ids @> jsonb_build_array(source->>'id') OR decision.right_evidence_ids @> jsonb_build_array(source->>'id'))
       ) AS item
     FROM founder_dna_eligible_edges decision
     JOIN founder_dna_eligible_profiles other ON other.release_id=decision.release_id
       AND other.entity_id=CASE WHEN decision.left_entity_id=staged.entity_id THEN decision.right_entity_id ELSE decision.left_entity_id END
     WHERE decision.release_id=staged.release_id
       AND (decision.left_entity_id=staged.entity_id OR decision.right_entity_id=staged.entity_id)
     ORDER BY decision.id LIMIT 3
   ) bounded
 ),'[]'::jsonb)) AS profile
FROM founder_dna_releases release
JOIN founder_dna_release_profiles staged ON staged.release_id=release.id
JOIN enrichment_entities entity ON entity.id=staged.entity_id
LEFT JOIN founder_dna_eligible_profiles eligible ON eligible.release_id=staged.release_id AND eligible.entity_id=staged.entity_id
WHERE release.id=selected_release AND release.status='validated';
$$;

CREATE OR REPLACE VIEW founder_dna_profile_reads AS
SELECT reads.*
FROM founder_dna_active_release active
CROSS JOIN LATERAL founder_dna_release_profile_reads(active.release_id) reads;

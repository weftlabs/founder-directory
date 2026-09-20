-- Every physically scoped v5/v6 judgment must remain retained.
CREATE OR REPLACE VIEW founder_dna_eligible_profiles AS
 SELECT p.* FROM founder_dna_release_profiles p
 JOIN enrichment_entities e ON e.id=p.entity_id AND e.kind='founder' AND e.status='active'
 JOIN enrichment_eligible_analyses a ON a.id=p.analysis_id AND a.entity_id=p.entity_id AND a.status='succeeded'
 JOIN enrichment_releases ar ON ar.id=a.release_id AND ar.status='approved'
 JOIN enrichment_eligible_analyses portrait ON portrait.id=p.portrait_analysis_id AND portrait.entity_id=p.entity_id AND portrait.status='succeeded' AND portrait.purpose='founder_portrait'
 JOIN enrichment_releases pr ON pr.id=portrait.release_id AND pr.status='approved'
 WHERE founder_dna_sources_eligible(a.evidence_ids) AND founder_dna_sources_eligible(portrait.evidence_ids)
 AND founder_dna_sources_eligible(coalesce((SELECT jsonb_agg(s->>'id') FROM jsonb_array_elements(p.profile->'sources') s),'[]'::jsonb))
 AND p.profile->>'id'=p.entity_id::text AND lower(p.profile->>'handle')=lower(e.legacy_key)
 AND p.profile->>'analysisId'=p.analysis_id::text AND p.profile->'portrait'->>'analysisId'=p.portrait_analysis_id::text
 AND portrait.validation_report->>'checksPassed'='true'
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(jsonb_build_array(portrait.validation_report->>'generationResponseArtifactId',portrait.validation_report->>'judgeRequestArtifactId',portrait.validation_report->>'judgeResponseArtifactId')) needed(id)
   WHERE needed.id IS NULL OR NOT EXISTS(SELECT 1 FROM enrichment_artifacts retained WHERE retained.id::text=needed.id AND retained.purged_at IS NULL AND (retained.expires_at IS NULL OR retained.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals w WHERE w.artifact_id=retained.id)))
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(portrait.validation_report->'productAnalysisIds','[]'::jsonb)) product(id)
   WHERE NOT EXISTS(SELECT 1 FROM enrichment_eligible_analyses pa JOIN enrichment_releases r ON r.id=pa.release_id AND r.status='approved' JOIN enrichment_founder_products relation ON relation.product_id=pa.entity_id AND relation.founder_id=p.entity_id
    WHERE pa.id::text=product.id AND pa.purpose='product_descriptions' AND pa.status='succeeded' AND founder_dna_sources_eligible(pa.evidence_ids) AND founder_dna_sources_eligible(jsonb_build_array(relation.evidence_id::text))))
 AND ((portrait.validation_report->>'judgeRecipeVersion' IS DISTINCT FROM 'cited-founder-portrait-judge-v5' AND portrait.validation_report->>'judgeRecipeVersion' IS DISTINCT FROM 'cited-founder-portrait-judge-v6') OR (
   jsonb_typeof(portrait.validation_report->'judgeExchanges')='array'
   AND jsonb_array_length(CASE WHEN jsonb_typeof(portrait.validation_report->'judgeExchanges')='array' THEN portrait.validation_report->'judgeExchanges' ELSE '[]'::jsonb END) BETWEEN 1 AND 15
   AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(portrait.validation_report->'judgeExchanges')='array' THEN portrait.validation_report->'judgeExchanges' ELSE '[]'::jsonb END) exchange
     CROSS JOIN LATERAL jsonb_array_elements_text(jsonb_build_array(exchange->>'requestArtifactId',exchange->>'responseArtifactId')) needed(id)
     WHERE needed.id IS NULL OR NOT EXISTS(SELECT 1 FROM enrichment_artifacts retained WHERE retained.id::text=needed.id AND retained.purged_at IS NULL AND (retained.expires_at IS NULL OR retained.expires_at>now()) AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals w WHERE w.artifact_id=retained.id))
   )
 ));

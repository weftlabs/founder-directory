-- Parentheses preserve both source arrays before concatenation.
CREATE OR REPLACE VIEW founder_dna_profile_reads AS
 SELECT lower(e.legacy_key) AS handle, CASE WHEN eligible.entity_id IS NULL THEN 'hidden' ELSE 'ready' END AS status,
 p.profile || jsonb_build_object('connections', coalesce((
 SELECT jsonb_agg(item ORDER BY edge_id) FROM (
 SELECT d.id AS edge_id, jsonb_build_object('id',d.id,'relation',d.relation,'reason',d.reason,
 'founder',jsonb_build_object('id',other.entity_id,'handle',other.profile->>'handle','name',other.profile->>'name','avatarUrl',other.profile->'avatarUrl','headline',other.profile->'portrait'->'archetype'->>'hook','revision',other.profile->>'revision'),
 'sourceIds',d.left_evidence_ids||d.right_evidence_ids,
 'sources',(SELECT jsonb_agg(DISTINCT s) FROM jsonb_array_elements((p.profile->'sources') || (other.profile->'sources')) s WHERE d.left_evidence_ids @> jsonb_build_array(s->>'id') OR d.right_evidence_ids @> jsonb_build_array(s->>'id'))) AS item
 FROM founder_dna_eligible_edges d JOIN founder_dna_eligible_profiles other ON other.release_id=d.release_id AND other.entity_id=CASE WHEN d.left_entity_id=p.entity_id THEN d.right_entity_id ELSE d.left_entity_id END
 WHERE d.release_id=p.release_id AND (d.left_entity_id=p.entity_id OR d.right_entity_id=p.entity_id) ORDER BY d.id LIMIT 3
 ) bounded),'[]'::jsonb)) AS profile
 FROM founder_dna_active_release active JOIN founder_dna_release_profiles p ON p.release_id=active.release_id
 JOIN enrichment_entities e ON e.id=p.entity_id
 LEFT JOIN founder_dna_eligible_profiles eligible ON eligible.release_id=p.release_id AND eligible.entity_id=p.entity_id;

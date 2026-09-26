CREATE TABLE founder_dna_releases (
 id text PRIMARY KEY, schema_version integer NOT NULL CHECK(schema_version=1), code_version text NOT NULL,
 manifest jsonb NOT NULL, manifest_hash text NOT NULL, expected_profiles integer NOT NULL CHECK(expected_profiles BETWEEN 1 AND 1000),
 status text NOT NULL DEFAULT 'staging' CHECK(status IN ('staging','validated')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE founder_dna_release_profiles (
 release_id text NOT NULL REFERENCES founder_dna_releases, entity_id uuid NOT NULL REFERENCES enrichment_entities,
 analysis_id uuid NOT NULL REFERENCES enrichment_analysis_runs, portrait_analysis_id uuid NOT NULL REFERENCES enrichment_analysis_runs,
 profile jsonb NOT NULL, profile_hash text NOT NULL, PRIMARY KEY(release_id,entity_id)
);
CREATE TABLE founder_dna_portrait_publications (
 entity_id uuid PRIMARY KEY REFERENCES enrichment_entities, analysis_id uuid NOT NULL REFERENCES enrichment_analysis_runs,
 approved_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE founder_dna_active_release (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), release_id text NOT NULL REFERENCES founder_dna_releases,
 previous_release_id text REFERENCES founder_dna_releases, activated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE founder_dna_connection_decisions (
 id text PRIMARY KEY, left_entity_id uuid NOT NULL REFERENCES enrichment_entities, right_entity_id uuid NOT NULL REFERENCES enrichment_entities,
 left_analysis_id uuid NOT NULL REFERENCES enrichment_analysis_runs, right_analysis_id uuid NOT NULL REFERENCES enrichment_analysis_runs,
 relation text NOT NULL CHECK(relation='related_work'), recipe_version text NOT NULL, model text NOT NULL,
 candidate_method text NOT NULL, state text NOT NULL CHECK(state IN ('accepted','rejected','insufficient')),
 reason text NOT NULL, left_evidence_ids jsonb NOT NULL, right_evidence_ids jsonb NOT NULL,
 request_artifact_id uuid NOT NULL REFERENCES enrichment_artifacts, response_artifact_id uuid NOT NULL REFERENCES enrichment_artifacts,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(left_entity_id<>right_entity_id)
);
CREATE TABLE founder_dna_release_edges (
 release_id text NOT NULL REFERENCES founder_dna_releases, decision_id text NOT NULL REFERENCES founder_dna_connection_decisions,
 PRIMARY KEY(release_id,decision_id)
);
CREATE FUNCTION founder_dna_sources_eligible(ids jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT jsonb_typeof(ids)='array' AND NOT EXISTS (
  SELECT 1 FROM jsonb_array_elements_text(ids) cited(id) WHERE NOT EXISTS (
   SELECT 1 FROM enrichment_evidence e JOIN enrichment_artifacts a ON a.id=e.artifact_id
   WHERE e.id::text=cited.id AND e.purged_at IS NULL AND a.purged_at IS NULL
   AND (a.expires_at IS NULL OR a.expires_at>now())
   AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals w WHERE w.artifact_id=a.id)
   AND NOT EXISTS(SELECT 1 FROM enrichment_entity_evidence l JOIN enrichment_entities owner ON owner.id=l.entity_id WHERE l.evidence_id=e.id AND owner.status<>'active')
  )
 )
$$;
CREATE VIEW founder_dna_eligible_profiles AS
 SELECT p.* FROM founder_dna_release_profiles p
 JOIN enrichment_entities e ON e.id=p.entity_id AND e.kind='founder' AND e.status='active'
 JOIN enrichment_eligible_analyses a ON a.id=p.analysis_id AND a.entity_id=p.entity_id AND a.status='succeeded'
 JOIN enrichment_releases ar ON ar.id=a.release_id AND ar.status='approved'
 JOIN enrichment_eligible_analyses portrait ON portrait.id=p.portrait_analysis_id AND portrait.entity_id=p.entity_id AND portrait.status='succeeded' AND portrait.purpose='founder_portrait'
 JOIN enrichment_releases pr ON pr.id=portrait.release_id AND pr.status='approved'
 WHERE founder_dna_sources_eligible(a.evidence_ids) AND founder_dna_sources_eligible(portrait.evidence_ids)
 AND founder_dna_sources_eligible(coalesce((SELECT jsonb_agg(s->>'id') FROM jsonb_array_elements(p.profile->'sources') s),'[]'::jsonb))
 AND p.profile->>'id'=p.entity_id::text AND lower(p.profile->>'handle')=lower(e.legacy_key)
 AND p.profile->>'analysisId'=p.analysis_id::text AND p.profile->'portrait'->>'analysisId'=p.portrait_analysis_id::text;
CREATE VIEW founder_dna_eligible_edges AS
 SELECT edge.release_id,d.* FROM founder_dna_release_edges edge JOIN founder_dna_connection_decisions d ON d.id=edge.decision_id AND d.state='accepted'
 JOIN founder_dna_eligible_profiles l ON l.release_id=edge.release_id AND l.entity_id=d.left_entity_id AND l.analysis_id=d.left_analysis_id
 JOIN founder_dna_eligible_profiles r ON r.release_id=edge.release_id AND r.entity_id=d.right_entity_id AND r.analysis_id=d.right_analysis_id
 JOIN enrichment_artifacts request ON request.id=d.request_artifact_id AND request.purged_at IS NULL
 JOIN enrichment_artifacts response ON response.id=d.response_artifact_id AND response.purged_at IS NULL
 WHERE founder_dna_sources_eligible(d.left_evidence_ids) AND founder_dna_sources_eligible(d.right_evidence_ids)
 AND (request.expires_at IS NULL OR request.expires_at>now()) AND (response.expires_at IS NULL OR response.expires_at>now())
 AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals w WHERE w.artifact_id IN(request.id,response.id));
CREATE VIEW founder_dna_profile_reads AS
 SELECT lower(e.legacy_key) AS handle, CASE WHEN eligible.entity_id IS NULL THEN 'hidden' ELSE 'ready' END AS status,
 p.profile || jsonb_build_object('connections', coalesce((
 SELECT jsonb_agg(item ORDER BY edge_id) FROM (
 SELECT d.id AS edge_id, jsonb_build_object('id',d.id,'relation',d.relation,'reason',d.reason,
 'founder',jsonb_build_object('id',other.entity_id,'handle',other.profile->>'handle','name',other.profile->>'name','avatarUrl',other.profile->'avatarUrl','headline',other.profile->'portrait'->'archetype'->>'hook','revision',other.profile->>'revision'),
 'sourceIds',d.left_evidence_ids||d.right_evidence_ids,
 'sources',(SELECT jsonb_agg(DISTINCT s) FROM jsonb_array_elements(p.profile->'sources'||other.profile->'sources') s WHERE d.left_evidence_ids @> jsonb_build_array(s->>'id') OR d.right_evidence_ids @> jsonb_build_array(s->>'id'))) AS item
 FROM founder_dna_eligible_edges d JOIN founder_dna_eligible_profiles other ON other.release_id=d.release_id AND other.entity_id=CASE WHEN d.left_entity_id=p.entity_id THEN d.right_entity_id ELSE d.left_entity_id END
 WHERE d.release_id=p.release_id AND (d.left_entity_id=p.entity_id OR d.right_entity_id=p.entity_id) ORDER BY d.id LIMIT 3
 ) bounded),'[]'::jsonb)) AS profile
 FROM founder_dna_active_release active JOIN founder_dna_release_profiles p ON p.release_id=active.release_id
 JOIN enrichment_entities e ON e.id=p.entity_id
 LEFT JOIN founder_dna_eligible_profiles eligible ON eligible.release_id=p.release_id AND eligible.entity_id=p.entity_id;
CREATE TRIGGER founder_dna_decisions_immutable BEFORE UPDATE OR DELETE ON founder_dna_connection_decisions FOR EACH ROW EXECUTE FUNCTION enrichment_immutable();
CREATE TRIGGER founder_dna_profiles_immutable BEFORE UPDATE OR DELETE ON founder_dna_release_profiles FOR EACH ROW EXECUTE FUNCTION enrichment_immutable();

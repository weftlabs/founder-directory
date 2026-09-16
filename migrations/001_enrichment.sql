CREATE TABLE enrichment_entities (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('founder','product')),
 legacy_key text UNIQUE, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suppressed')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE enrichment_budgets (
 id uuid PRIMARY KEY, scope text NOT NULL, currency text NOT NULL,
 cap_micros bigint NOT NULL CHECK(cap_micros >= 0), committed_micros bigint NOT NULL DEFAULT 0,
 CHECK(committed_micros >= 0)
);
CREATE TABLE enrichment_collection_requests (
 id uuid PRIMARY KEY, scope text NOT NULL, fingerprint text NOT NULL, generation integer NOT NULL CHECK(generation >= 0),
 operation text NOT NULL, args jsonb NOT NULL, policy_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(scope,fingerprint,generation)
);
CREATE TABLE enrichment_collection_attempts (
 id uuid PRIMARY KEY, request_id uuid NOT NULL REFERENCES enrichment_collection_requests,
 ordinal integer NOT NULL, client_key uuid NOT NULL UNIQUE, budget_id uuid NOT NULL REFERENCES enrichment_budgets,
 cap_micros bigint NOT NULL CHECK(cap_micros >= 0), settled_micros bigint CHECK(settled_micros >= 0),
 dispatch_state text NOT NULL DEFAULT 'reserved' CHECK(dispatch_state IN ('reserved','dispatching','captured','uncertain','not_charged')),
 payment_state text NOT NULL DEFAULT 'pending' CHECK(payment_state IN ('pending','uncertain','settled','not_charged')),
 reason text, resolution jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(request_id,ordinal)
);
CREATE UNIQUE INDEX enrichment_one_unresolved_attempt ON enrichment_collection_attempts(request_id) WHERE dispatch_state <> 'not_charged';
CREATE TABLE enrichment_artifacts (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('source_response','generation_request','generation_response','manifest','local_transform','legacy_import','tool_request','tool_response')),
 attempt_id uuid REFERENCES enrichment_collection_attempts, run_id uuid, import_batch text,
 sha256 text NOT NULL, body bytea NOT NULL, byte_length integer NOT NULL CHECK(byte_length >= 0),
 content_type text NOT NULL, redaction_version text NOT NULL, metadata jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz, purged_at timestamptz, CHECK(octet_length(body)=byte_length),
 CHECK(num_nonnulls(attempt_id,run_id,import_batch)=1)
);
CREATE FUNCTION enrichment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable record'; END $$;
CREATE FUNCTION enrichment_artifact_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
 AND NEW.body='\x'::bytea AND NEW.byte_length=0
 AND NEW.metadata='{}'::jsonb
 AND (to_jsonb(NEW)-ARRAY['body','byte_length','purged_at','metadata'])=(to_jsonb(OLD)-ARRAY['body','byte_length','purged_at','metadata'])
 THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'immutable artifact; only controlled body purge permitted';
END $$;
CREATE TRIGGER enrichment_artifacts_immutable BEFORE UPDATE OR DELETE ON enrichment_artifacts FOR EACH ROW EXECUTE FUNCTION enrichment_artifact_guard();
CREATE TABLE enrichment_artifact_withdrawals (artifact_id uuid PRIMARY KEY REFERENCES enrichment_artifacts, reason text NOT NULL, actor text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE enrichment_evidence (
 id uuid PRIMARY KEY, artifact_id uuid NOT NULL REFERENCES enrichment_artifacts,
 extractor_version text NOT NULL, locator text NOT NULL, source_id text, source_url text,
 author_id text, published_at timestamptz, payload jsonb NOT NULL, excerpt text NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(), purged_at timestamptz, UNIQUE(artifact_id,extractor_version,locator)
);
CREATE FUNCTION enrichment_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
 AND NEW.payload='{}'::jsonb AND NEW.excerpt='' AND NEW.source_id IS NULL AND NEW.source_url IS NULL AND NEW.author_id IS NULL AND NEW.published_at IS NULL
 AND (to_jsonb(NEW)-ARRAY['payload','excerpt','source_id','source_url','author_id','published_at','purged_at'])=(to_jsonb(OLD)-ARRAY['payload','excerpt','source_id','source_url','author_id','published_at','purged_at'])
 THEN RETURN NEW; END IF; RAISE EXCEPTION 'immutable evidence; only controlled purge permitted';
END $$;
CREATE TRIGGER enrichment_evidence_immutable BEFORE UPDATE OR DELETE ON enrichment_evidence FOR EACH ROW EXECUTE FUNCTION enrichment_evidence_guard();
CREATE TABLE enrichment_entity_evidence (
 entity_id uuid NOT NULL REFERENCES enrichment_entities, evidence_id uuid NOT NULL REFERENCES enrichment_evidence,
 relation text NOT NULL, PRIMARY KEY(entity_id,evidence_id,relation)
);
CREATE TABLE enrichment_index_origins (
 founder_id uuid PRIMARY KEY REFERENCES enrichment_entities, evidence_id uuid REFERENCES enrichment_evidence,
 status text NOT NULL CHECK(status IN ('confirmed','legacy-unverified','unknown')), indexed_at timestamptz,
 CHECK(status='unknown' OR evidence_id IS NOT NULL)
);
CREATE TRIGGER enrichment_origins_immutable BEFORE UPDATE OR DELETE ON enrichment_index_origins FOR EACH ROW EXECUTE FUNCTION enrichment_immutable();
CREATE TABLE enrichment_founder_products (
 founder_id uuid NOT NULL REFERENCES enrichment_entities, product_id uuid NOT NULL REFERENCES enrichment_entities,
 evidence_id uuid NOT NULL REFERENCES enrichment_evidence, PRIMARY KEY(founder_id,product_id,evidence_id), CHECK(founder_id <> product_id)
);
CREATE TABLE enrichment_releases (
 id uuid PRIMARY KEY, manifest jsonb NOT NULL, status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','retired')),
 evaluation_artifact_id uuid REFERENCES enrichment_artifacts, approval jsonb,
 CHECK(status <> 'approved' OR (evaluation_artifact_id IS NOT NULL AND approval IS NOT NULL))
);
CREATE FUNCTION enrichment_release_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.manifest IS DISTINCT FROM OLD.manifest THEN RAISE EXCEPTION 'immutable release manifest'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enrichment_release_manifest_immutable BEFORE UPDATE ON enrichment_releases FOR EACH ROW EXECUTE FUNCTION enrichment_release_guard();
CREATE TABLE enrichment_intake (
 scope text PRIMARY KEY, release_id uuid NOT NULL REFERENCES enrichment_releases, revision bigint NOT NULL DEFAULT 1,
 catchup_pending boolean NOT NULL DEFAULT true
);
CREATE TABLE enrichment_targets (
 entity_id uuid PRIMARY KEY REFERENCES enrichment_entities, scope text NOT NULL REFERENCES enrichment_intake,
 release_id uuid NOT NULL REFERENCES enrichment_releases, revision bigint NOT NULL, generation integer NOT NULL DEFAULT 0
);
CREATE TABLE enrichment_campaigns (
 id uuid PRIMARY KEY, scope text NOT NULL, release_id uuid NOT NULL REFERENCES enrichment_releases,
 manifest_artifact_id uuid NOT NULL REFERENCES enrichment_artifacts, mode text NOT NULL CHECK(mode IN ('rederive','acquire')),
 budget_id uuid REFERENCES enrichment_budgets, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE enrichment_campaign_members (
 campaign_id uuid NOT NULL REFERENCES enrichment_campaigns, entity_id uuid NOT NULL REFERENCES enrichment_entities,
 PRIMARY KEY(campaign_id,entity_id)
);
CREATE TABLE enrichment_stage_work (
 id uuid PRIMARY KEY, entity_id uuid NOT NULL REFERENCES enrichment_entities, release_id uuid NOT NULL REFERENCES enrichment_releases,
 generation integer NOT NULL, stage text NOT NULL, status text NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','running','succeeded','not_applicable','unavailable','blocked','failed','cancelled')),
 reason text, evidence_id uuid REFERENCES enrichment_evidence, output_id uuid,
 lease_token uuid, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 CHECK(status <> 'not_applicable' OR (evidence_id IS NOT NULL AND reason IS NOT NULL)),
 UNIQUE(entity_id,release_id,generation,stage)
);
CREATE TABLE enrichment_analysis_runs (
 id uuid PRIMARY KEY, entity_id uuid NOT NULL REFERENCES enrichment_entities, release_id uuid NOT NULL REFERENCES enrichment_releases,
 generation integer NOT NULL, purpose text NOT NULL, input_artifact_id uuid NOT NULL REFERENCES enrichment_artifacts,
 input_digest text NOT NULL, recipe_digest text NOT NULL, evidence_ids jsonb NOT NULL, output jsonb,
 validation_report jsonb NOT NULL, status text NOT NULL CHECK(status IN ('succeeded','failed','missing_input')),
 created_at timestamptz NOT NULL DEFAULT now(), purged_at timestamptz
);
CREATE FUNCTION enrichment_analysis_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.purged_at IS NULL AND NEW.purged_at IS NOT NULL
 AND NEW.output IS NULL AND NEW.validation_report='{}'::jsonb
 AND (to_jsonb(NEW)-ARRAY['output','validation_report','purged_at'])=(to_jsonb(OLD)-ARRAY['output','validation_report','purged_at'])
 THEN RETURN NEW; END IF; RAISE EXCEPTION 'immutable analysis; only controlled purge permitted';
END $$;
CREATE TRIGGER enrichment_analyses_immutable BEFORE UPDATE OR DELETE ON enrichment_analysis_runs FOR EACH ROW EXECUTE FUNCTION enrichment_analysis_guard();
CREATE INDEX enrichment_analysis_reuse ON enrichment_analysis_runs(entity_id,purpose,input_digest,recipe_digest) WHERE status='succeeded';
CREATE VIEW enrichment_eligible_analyses AS SELECT a.* FROM enrichment_analysis_runs a
 JOIN enrichment_entities owner ON owner.id=a.entity_id AND owner.status='active'
 JOIN enrichment_artifacts manifest ON manifest.id=a.input_artifact_id AND manifest.purged_at IS NULL
 WHERE a.purged_at IS NULL AND (manifest.expires_at IS NULL OR manifest.expires_at>now())
 AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals x WHERE x.artifact_id=manifest.id)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(a.evidence_ids) claim(id) WHERE NOT EXISTS(
   SELECT 1 FROM enrichment_evidence e JOIN enrichment_artifacts raw ON raw.id=e.artifact_id
   JOIN enrichment_entity_evidence link ON link.evidence_id=e.id AND link.entity_id=a.entity_id
   WHERE e.id::text=claim.id AND raw.purged_at IS NULL AND (raw.expires_at IS NULL OR raw.expires_at>now())
   AND NOT EXISTS(SELECT 1 FROM enrichment_artifact_withdrawals x WHERE x.artifact_id=raw.id)));
CREATE TABLE enrichment_profiles (
 entity_id uuid PRIMARY KEY REFERENCES enrichment_entities, analysis_id uuid NOT NULL REFERENCES enrichment_analysis_runs,
 category text, tags text[] NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE enrichment_publication_events (
 id uuid PRIMARY KEY, entity_id uuid REFERENCES enrichment_entities, prior_analysis_id uuid REFERENCES enrichment_analysis_runs,
 analysis_id uuid REFERENCES enrichment_analysis_runs, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE enrichment_promotion_events (
 id uuid PRIMARY KEY, scope text NOT NULL, release_id uuid NOT NULL REFERENCES enrichment_releases, revision bigint NOT NULL,
 reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE enrichment_embeddings (
 id uuid PRIMARY KEY, scope text NOT NULL, input_text text NOT NULL, input_hash text NOT NULL,
 template_version text NOT NULL, model text NOT NULL, model_version text NOT NULL, distance text NOT NULL CHECK(distance IN ('cosine','euclidean','dot')), dimensions integer NOT NULL CHECK(dimensions > 0),
 vector double precision[] NOT NULL, attempt_id uuid REFERENCES enrichment_collection_attempts,
 CHECK(array_length(vector,1)=dimensions), UNIQUE(scope,input_hash,template_version,model,model_version,distance,dimensions)
);
CREATE TABLE enrichment_analysis_embeddings (
 entity_id uuid NOT NULL REFERENCES enrichment_entities, analysis_id uuid NOT NULL REFERENCES enrichment_analysis_runs,
 embedding_id uuid NOT NULL REFERENCES enrichment_embeddings, purpose text NOT NULL,
 PRIMARY KEY(analysis_id,embedding_id,purpose)
);

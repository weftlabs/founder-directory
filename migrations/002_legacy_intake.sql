CREATE TABLE enrichment_founder_intake (
  founder_key text PRIMARY KEY,
  snapshot jsonb NOT NULL,
  origin_status text NOT NULL CHECK(origin_status IN ('confirmed','legacy-unverified','unknown')),
  captured_at timestamptz NOT NULL DEFAULT now(),
  imported_at timestamptz
);

CREATE FUNCTION enrichment_enqueue_founder() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO enrichment_founder_intake(founder_key,snapshot,origin_status)
  VALUES(lower(NEW.handle),to_jsonb(NEW),'confirmed')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

-- Installing this migration is explicit. No paid work runs in the trigger.
DO $$ BEGIN
  IF to_regclass('public.founders') IS NOT NULL THEN
    CREATE TRIGGER enrichment_founder_created AFTER INSERT ON founders
    FOR EACH ROW EXECUTE FUNCTION enrichment_enqueue_founder();
    INSERT INTO enrichment_founder_intake(founder_key,snapshot,origin_status)
    SELECT lower(handle),to_jsonb(f),'legacy-unverified' FROM founders f
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

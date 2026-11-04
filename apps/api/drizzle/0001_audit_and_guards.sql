-- Custom migration: immutability, hash chain, sequences and grants (DATA-MODEL §5).

-- Generic append-only guard
CREATE OR REPLACE FUNCTION forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER stage_history_no_update BEFORE UPDATE OR DELETE ON stage_history
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER stage_history_no_truncate BEFORE TRUNCATE ON stage_history
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint

-- Canonical text of an audit row. occurred_at is hashed as epoch (timezone-independent).
CREATE OR REPLACE FUNCTION audit_log_canonical(
  p_occurred_at timestamptz, p_actor uuid, p_action audit_action, p_entity_type text,
  p_entity_id text, p_changes jsonb, p_reason text
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    't', extract(epoch FROM p_occurred_at)::text,
    'a', p_actor, 'ac', p_action, 'et', p_entity_type, 'ei', p_entity_id,
    'c', p_changes, 'r', p_reason)::text
$$;
--> statement-breakpoint

-- Hash chain: hash = sha256(hex(prev_hash) ‖ canonical(row)), serialized by advisory lock.
CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_hash bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(4242);
  SELECT hash INTO last_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := last_hash;
  NEW.hash := digest(
    coalesce(encode(last_hash, 'hex'), '') ||
    audit_log_canonical(NEW.occurred_at, NEW.actor_user_id, NEW.action, NEW.entity_type,
                        NEW.entity_id, NEW.changes, NEW.reason),
    'sha256');
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_log_hash BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();
--> statement-breakpoint

-- Verification: walks the chain; returns rows checked and the first broken id (NULL = OK).
CREATE OR REPLACE FUNCTION audit_log_verify()
RETURNS TABLE(checked bigint, first_broken_id bigint) LANGUAGE plpgsql STABLE AS $$
DECLARE r record; prev bytea := NULL; n bigint := 0; expected bytea;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY id LOOP
    n := n + 1;
    expected := digest(
      coalesce(encode(prev, 'hex'), '') ||
      audit_log_canonical(r.occurred_at, r.actor_user_id, r.action, r.entity_type,
                          r.entity_id, r.changes, r.reason),
      'sha256');
    IF r.prev_hash IS DISTINCT FROM prev OR r.hash <> expected THEN
      checked := n; first_broken_id := r.id; RETURN NEXT; RETURN;
    END IF;
    prev := r.hash;
  END LOOP;
  checked := n; first_broken_id := NULL; RETURN NEXT;
END $$;
--> statement-breakpoint

-- Readable opportunity codes OPP-yyyy-nnnn
CREATE SEQUENCE IF NOT EXISTS opportunity_code_seq;
--> statement-breakpoint

-- Runtime role grants (role created by docker/postgres/init/01-roles.sh); skipped if absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wcrm_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO wcrm_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wcrm_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wcrm_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, stage_history FROM wcrm_app';
  END IF;
END $$;

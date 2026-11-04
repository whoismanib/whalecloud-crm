-- Phase 2: immutable forecast snapshots (P12-03) and grants for new tables.
CREATE TRIGGER forecast_snapshots_no_update BEFORE UPDATE OR DELETE ON forecast_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER forecast_snapshots_no_truncate BEFORE TRUNCATE ON forecast_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER forecast_snapshot_items_no_update BEFORE UPDATE OR DELETE ON forecast_snapshot_items
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE TRIGGER forecast_snapshot_items_no_truncate BEFORE TRUNCATE ON forecast_snapshot_items
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS change_request_code_seq;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wcrm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO wcrm_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wcrm_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, stage_history, forecast_snapshots, forecast_snapshot_items FROM wcrm_app';
  END IF;
END $$;

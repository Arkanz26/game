-- SILIKA: database-level invariants that must hold regardless of which code path writes.
-- Statements are separated by drizzle statement breakpoints.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- ===========================================================================
-- Generic helpers
-- ===========================================================================
CREATE OR REPLACE FUNCTION silika_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SILIKA: tabel % bersifat append-only (% ditolak)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION silika_actor_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('silika.actor_id', true), '')::uuid
$$;
--> statement-breakpoint

-- ===========================================================================
-- Audit log: append-only + hash chain
-- ===========================================================================
CREATE OR REPLACE FUNCTION silika_audit_payload(a audit_log) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(a.prev_hash, '') || '|' || a.id::text || '|' ||
         to_char(a.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
         coalesce(a.actor_user_id::text, '') || '|' || a.action || '|' || a.entity_type || '|' ||
         coalesce(a.entity_id, '') || '|' || coalesce(a.bdl_id::text, '') || '|' ||
         coalesce(a.before::text, '') || '|' || coalesce(a.after::text, '')
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION silika_audit_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  last_hash text;
BEGIN
  -- Serialise appends so ids follow commit order and every row links to its predecessor.
  PERFORM pg_advisory_xact_lock(7243001);
  NEW.id := nextval(pg_get_serial_sequence('audit_log', 'id'));
  SELECT hash INTO last_hash FROM audit_log ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := last_hash;
  NEW.hash := encode(sha256(convert_to(silika_audit_payload(NEW), 'UTF8')), 'hex');
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION silika_audit_chain();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION silika_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION silika_reject_mutation();
--> statement-breakpoint

-- Returns the first audit row whose hash does not match (NULL = chain intact).
CREATE OR REPLACE FUNCTION silika_audit_verify_chain() RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_log;
  expected_prev text := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY id LOOP
    IF r.prev_hash IS DISTINCT FROM expected_prev
       OR r.hash <> encode(sha256(convert_to(silika_audit_payload(r), 'UTF8')), 'hex') THEN
      RETURN r.id;
    END IF;
    expected_prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint

-- ===========================================================================
-- Versioned configuration tables: immutable rows, non-overlapping versions,
-- every change logged in audit_log (even when made outside the application).
-- ===========================================================================
CREATE OR REPLACE FUNCTION silika_config_row_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SILIKA: konfigurasi % tidak boleh dihapus; tutup versinya dengan effective_to', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;
  IF OLD.effective_to IS NOT NULL THEN
    RAISE EXCEPTION 'SILIKA: versi konfigurasi %/% sudah ditutup', TG_TABLE_NAME, OLD.code
      USING ERRCODE = 'P0001';
  END IF;
  IF (to_jsonb(NEW) - 'effective_to') IS DISTINCT FROM (to_jsonb(OLD) - 'effective_to') THEN
    RAISE EXCEPTION 'SILIKA: baris konfigurasi % bersifat immutable; buat versi baru', TG_TABLE_NAME
      USING ERRCODE = 'P0001';
  END IF;
  IF NEW.effective_to IS NOT NULL AND NEW.effective_to <= NEW.effective_from THEN
    RAISE EXCEPTION 'SILIKA: effective_to harus setelah effective_from' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION silika_config_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, before, after)
  VALUES (
    coalesce(silika_actor_id(), NEW.created_by),
    'config.' || lower(TG_OP),
    TG_TABLE_NAME,
    NEW.id::text,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END,
    to_jsonb(NEW)
  );
  RETURN NEW;
END $$;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts', 'lapan_line_items', 'transaction_types',
                           'approval_chain_templates', 'approval_matrix_rules', 'system_parameters']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION silika_config_row_guard()', t || '_guard', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION silika_config_audit()', t || '_audit', t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (code, version)', t, t || '_code_version_uq');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I EXCLUDE USING gist (code WITH =, daterange(effective_from, effective_to, ''[)'') WITH &&)', t, t || '_no_overlap');
  END LOOP;
END $$;
--> statement-breakpoint

-- Chain steps belong to an immutable template version.
CREATE TRIGGER approval_chain_steps_immutable BEFORE UPDATE OR DELETE ON approval_chain_steps
  FOR EACH ROW EXECUTE FUNCTION silika_reject_mutation();
--> statement-breakpoint

-- ===========================================================================
-- Documents: versions immutable; LOCKED documents frozen.
-- ===========================================================================
CREATE TRIGGER document_versions_immutable BEFORE UPDATE OR DELETE ON document_versions
  FOR EACH ROW EXECUTE FUNCTION silika_reject_mutation();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION silika_document_version_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st document_status;
BEGIN
  SELECT status INTO st FROM documents WHERE id = NEW.document_id;
  IF st IN ('LOCKED', 'SUPERSEDED') THEN
    RAISE EXCEPTION 'SILIKA: dokumen berstatus % tidak dapat diberi versi baru', st USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER document_versions_insert_guard BEFORE INSERT ON document_versions
  FOR EACH ROW EXECUTE FUNCTION silika_document_version_insert_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION silika_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SILIKA: dokumen tidak boleh dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'LOCKED' AND (NEW.status NOT IN ('LOCKED', 'SUPERSEDED')
      OR NEW.current_version_no <> OLD.current_version_no
      OR NEW.bdl_id <> OLD.bdl_id OR NEW.document_type_code <> OLD.document_type_code) THEN
    RAISE EXCEPTION 'SILIKA: dokumen terkunci tidak dapat diubah' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER documents_guard BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION silika_documents_guard();
--> statement-breakpoint

-- ===========================================================================
-- Ledger periods: no overlap, forward-only status, lock requires all entries final.
-- ===========================================================================
ALTER TABLE ledger_periods ADD CONSTRAINT ledger_periods_no_overlap
  EXCLUDE USING gist (bdl_id WITH =, daterange(period_start, period_end, '[]') WITH &&);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION silika_ledger_periods_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pending int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'SILIKA: periode tidak boleh dihapus' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.bdl_id <> OLD.bdl_id OR NEW.period_start <> OLD.period_start OR NEW.period_end <> OLD.period_end THEN
    RAISE EXCEPTION 'SILIKA: identitas periode tidak boleh diubah' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'SILIKA: periode yang LAPAN-nya telah disetujui bersifat final' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'OPEN' AND NEW.status = 'LOCKED') OR (OLD.status = 'LOCKED' AND NEW.status = 'APPROVED')) THEN
      RAISE EXCEPTION 'SILIKA: transisi status periode % → % tidak diizinkan', OLD.status, NEW.status
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status = 'LOCKED' THEN
      SELECT count(*) INTO pending FROM ledger_entries
       WHERE period_id = NEW.id AND status IN ('DRAFT', 'SUBMITTED');
      IF pending > 0 THEN
        RAISE EXCEPTION 'SILIKA: masih ada % entri belum final (DRAFT/SUBMITTED) pada periode ini', pending
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_periods_guard BEFORE UPDATE OR DELETE ON ledger_periods
  FOR EACH ROW EXECUTE FUNCTION silika_ledger_periods_guard();
--> statement-breakpoint

-- ===========================================================================
-- Ledger entries: only into OPEN periods; back-dated entries only through an
-- approved correction request; VERIFIED/REJECTED entries are final.
-- ===========================================================================
CREATE OR REPLACE FUNCTION silika_ledger_entries_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p ledger_periods%ROWTYPE;
  op ledger_periods%ROWTYPE;
  cr period_correction_requests%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO p FROM ledger_periods WHERE id = OLD.period_id;
    IF OLD.status <> 'DRAFT' OR p.status <> 'OPEN' THEN
      RAISE EXCEPTION 'SILIKA: hanya entri DRAFT pada periode OPEN yang boleh dihapus' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('VERIFIED', 'REJECTED') THEN
      RAISE EXCEPTION 'SILIKA: entri #% sudah final (%); gunakan reversal/koreksi', OLD.entry_no, OLD.status
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.bdl_id <> OLD.bdl_id OR NEW.entry_no <> OLD.entry_no OR NEW.created_by <> OLD.created_by
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'SILIKA: identitas entri tidak boleh diubah' USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('DRAFT', 'SUBMITTED'))
         OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('DRAFT', 'VERIFIED', 'REJECTED'))) THEN
      RAISE EXCEPTION 'SILIKA: transisi status entri % → % tidak diizinkan', OLD.status, NEW.status
        USING ERRCODE = 'P0001';
    END IF;
    -- A submitted entry is under review: its substance cannot change (withdraw to DRAFT first).
    IF OLD.status = 'SUBMITTED' AND (NEW.amount <> OLD.amount OR NEW.inputs <> OLD.inputs
        OR NEW.transaction_date <> OLD.transaction_date OR NEW.transaction_type_id <> OLD.transaction_type_id
        OR NEW.period_id <> OLD.period_id) THEN
      RAISE EXCEPTION 'SILIKA: entri yang sedang diverifikasi tidak boleh diubah' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO p FROM ledger_periods WHERE id = NEW.period_id;
  IF p.bdl_id <> NEW.bdl_id THEN
    RAISE EXCEPTION 'SILIKA: periode bukan milik BDL entri' USING ERRCODE = 'P0001';
  END IF;
  IF p.status <> 'OPEN' THEN
    RAISE EXCEPTION 'SILIKA: periode % s.d. % berstatus %; transaksi hanya dapat dicatat lewat koreksi di periode berjalan',
      p.period_start, p.period_end, p.status USING ERRCODE = 'P0001';
  END IF;

  IF NEW.transaction_date > p.period_end THEN
    RAISE EXCEPTION 'SILIKA: tanggal transaksi % melewati akhir periode %', NEW.transaction_date, p.period_end
      USING ERRCODE = 'P0001';
  ELSIF NEW.transaction_date >= p.period_start THEN
    IF NEW.origin_period_id IS NOT NULL AND NEW.origin_period_id <> NEW.period_id THEN
      RAISE EXCEPTION 'SILIKA: origin_period_id tidak konsisten dengan tanggal transaksi' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- Back-dated: must be an explicit correction of a locked period.
    IF NEW.entry_kind = 'NORMAL' OR NEW.correction_request_id IS NULL THEN
      RAISE EXCEPTION 'SILIKA: transaksi bertanggal % berada pada periode terkunci; gunakan Permohonan Koreksi',
        NEW.transaction_date USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO cr FROM period_correction_requests WHERE id = NEW.correction_request_id;
    IF cr.status <> 'APPROVED' OR cr.bdl_id <> NEW.bdl_id THEN
      RAISE EXCEPTION 'SILIKA: permohonan koreksi belum disetujui' USING ERRCODE = 'P0001';
    END IF;
    IF TG_OP = 'INSERT' AND (cr.window_until IS NULL OR cr.window_until < now()) THEN
      RAISE EXCEPTION 'SILIKA: jendela koreksi telah berakhir' USING ERRCODE = 'P0001';
    END IF;
    IF NEW.origin_period_id IS DISTINCT FROM cr.target_period_id THEN
      RAISE EXCEPTION 'SILIKA: origin_period_id harus sama dengan periode yang dikoreksi' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO op FROM ledger_periods WHERE id = cr.target_period_id;
    IF NEW.transaction_date < op.period_start OR NEW.transaction_date > op.period_end THEN
      RAISE EXCEPTION 'SILIKA: tanggal transaksi koreksi di luar periode yang dikoreksi' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION silika_ledger_entries_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION silika_posting_lines_insert_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  e ledger_entries%ROWTYPE;
BEGIN
  SELECT * INTO e FROM ledger_entries WHERE id = NEW.entry_id;
  IF e.status <> 'VERIFIED' OR e.period_id <> NEW.period_id THEN
    RAISE EXCEPTION 'SILIKA: posting hanya untuk entri VERIFIED pada periodenya' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER ledger_posting_lines_insert_guard BEFORE INSERT ON ledger_posting_lines
  FOR EACH ROW EXECUTE FUNCTION silika_posting_lines_insert_guard();
--> statement-breakpoint
CREATE TRIGGER ledger_posting_lines_immutable BEFORE UPDATE OR DELETE ON ledger_posting_lines
  FOR EACH ROW EXECUTE FUNCTION silika_reject_mutation();
--> statement-breakpoint

-- ===========================================================================
-- Net asset statements (LANAP/LANIR): frozen once LOCKED.
-- ===========================================================================
CREATE OR REPLACE FUNCTION silika_statements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'SILIKA: laporan aset neto non-draft tidak boleh dihapus' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'SILIKA: % per % sudah dikunci', OLD.kind, OLD.as_of_date USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER net_asset_statements_guard BEFORE UPDATE OR DELETE ON net_asset_statements
  FOR EACH ROW EXECUTE FUNCTION silika_statements_guard();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION silika_statement_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  st statement_status;
BEGIN
  SELECT status INTO st FROM net_asset_statements
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.statement_id ELSE NEW.statement_id END;
  IF st <> 'DRAFT' THEN
    RAISE EXCEPTION 'SILIKA: baris laporan aset neto hanya dapat diubah saat DRAFT' USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER net_asset_statement_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON net_asset_statement_lines
  FOR EACH ROW EXECUTE FUNCTION silika_statement_lines_guard();
--> statement-breakpoint

-- ===========================================================================
-- Application role: the runtime login role should be a member of silika_app.
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'silika_app') THEN
    CREATE ROLE silika_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO silika_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO silika_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO silika_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO silika_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO silika_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, document_versions, ledger_posting_lines, approval_chain_steps FROM silika_app;

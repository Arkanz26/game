CREATE TYPE "public"."account_class" AS ENUM('ASSET', 'CONTRA_ASSET', 'LIABILITY');--> statement-breakpoint
CREATE TYPE "public"."approval_request_status" AS ENUM('PENDING', 'APPROVED', 'RETURNED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."approval_step_scope" AS ENUM('SAME_DIVISION', 'GLOBAL');--> statement-breakpoint
CREATE TYPE "public"."approval_step_status" AS ENUM('WAITING', 'PENDING', 'APPROVED', 'RETURNED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('local', 'oidc', 'ldap');--> statement-breakpoint
CREATE TYPE "public"."bank_class" AS ENUM('BU', 'BPR', 'BPRS');--> statement-breakpoint
CREATE TYPE "public"."bank_type" AS ENUM('KONVENSIONAL', 'SYARIAH');--> statement-breakpoint
CREATE TYPE "public"."bdl_grade" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."confidentiality" AS ENUM('INTERNAL', 'RAHASIA', 'SANGAT_RAHASIA');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'RETURNED', 'USED');--> statement-breakpoint
CREATE TYPE "public"."counterparty_type" AS ENUM('DEBITUR', 'KREDITUR', 'KREDITUR_SEPARATIS', 'PEMBELI', 'TIM_LIKUIDASI', 'LAINNYA');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'LOCKED', 'SUPERSEDED');--> statement-breakpoint
CREATE TYPE "public"."entry_kind" AS ENUM('NORMAL', 'CORRECTION', 'REVERSAL');--> statement-breakpoint
CREATE TYPE "public"."entry_status" AS ENUM('DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."lapan_section" AS ENUM('PENAMBAHAN', 'PENGURANGAN', 'KOREKSI');--> statement-breakpoint
CREATE TYPE "public"."lifecycle_stage" AS ENUM('PERSIAPAN', 'PENGAMANAN_ASET', 'PENUNJUKAN_TL', 'OPERASIONAL', 'NERACA_PENUTUPAN', 'PENGAKHIRAN', 'SELESAI');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('OPEN', 'LOCKED', 'APPROVED');--> statement-breakpoint
CREATE TYPE "public"."regulation_type" AS ENUM('UU', 'PLPS', 'PADK', 'PDK', 'KADK');--> statement-breakpoint
CREATE TYPE "public"."role_code" AS ENUM('TL', 'PIC_GLIB', 'KATIM', 'KADIV', 'DIREKTUR_GROUP', 'ADK', 'ADMIN', 'AUDITOR');--> statement-breakpoint
CREATE TYPE "public"."scope_type" AS ENUM('GLOBAL', 'DIVISION', 'BDL');--> statement-breakpoint
CREATE TYPE "public"."statement_kind" AS ENUM('LANAP', 'LANIR');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('DRAFT', 'IN_REVIEW', 'LOCKED');--> statement-breakpoint
CREATE TYPE "public"."threshold_basis" AS ENUM('INSURED_DEPOSITS', 'DOCUMENT_AMOUNT');--> statement-breakpoint
CREATE TYPE "public"."tl_end_reason" AS ENUM('MENINGGAL', 'ROTASI', 'PEMBERHENTIAN_LAIN', 'BERAKHIR_MASA_TUGAS');--> statement-breakpoint
CREATE TYPE "public"."tl_position" AS ENUM('KETUA', 'ANGGOTA');--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "divisions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role" "role_code" NOT NULL,
	"permission" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_permission_pk" PRIMARY KEY("role","permission")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role_code" NOT NULL,
	"scope_type" "scope_type" NOT NULL,
	"division_id" uuid,
	"bdl_id" uuid,
	"valid_from" date DEFAULT now() NOT NULL,
	"valid_to" date,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ura_scope_target" CHECK (("user_role_assignments"."scope_type" = 'GLOBAL' AND "user_role_assignments"."division_id" IS NULL AND "user_role_assignments"."bdl_id" IS NULL)
        OR ("user_role_assignments"."scope_type" = 'DIVISION' AND "user_role_assignments"."division_id" IS NOT NULL AND "user_role_assignments"."bdl_id" IS NULL)
        OR ("user_role_assignments"."scope_type" = 'BDL' AND "user_role_assignments"."bdl_id" IS NOT NULL AND "user_role_assignments"."division_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nip" text,
	"name" text NOT NULL,
	"password_hash" text,
	"auth_provider" "auth_provider" DEFAULT 'local' NOT NULL,
	"external_subject" text,
	"division_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_local_requires_password" CHECK ("users"."auth_provider" <> 'local' OR "users"."password_hash" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "bdl" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"bank_class" "bank_class" NOT NULL,
	"bank_type" "bank_type" NOT NULL,
	"grade" "bdl_grade" NOT NULL,
	"has_separatist_creditor" boolean DEFAULT false NOT NULL,
	"insured_deposits_amount" numeric(20, 2) DEFAULT '0' NOT NULL,
	"lifecycle_stage" "lifecycle_stage" DEFAULT 'PERSIAPAN' NOT NULL,
	"division_id" uuid NOT NULL,
	"license_revoked_date" date,
	"liquidation_start_date" date,
	"city" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bdl_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "bdl_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bdl_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"ref_entity_type" text,
	"ref_entity_id" text,
	"actor_id" uuid
);
--> statement-breakpoint
CREATE TABLE "bdl_stage_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bdl_id" uuid NOT NULL,
	"stage" "lifecycle_stage" NOT NULL,
	"entered_at" date NOT NULL,
	"note" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liquidation_team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bdl_id" uuid NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"position" "tl_position" NOT NULL,
	"appointed_at" date NOT NULL,
	"decree_ref" text,
	"ended_at" date,
	"end_reason" "tl_end_reason",
	"replaces_member_id" uuid,
	"legal_basis_article_id" uuid,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulation_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"regulation_id" uuid NOT NULL,
	"article_ref" text NOT NULL,
	"heading" text,
	"body" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "regulation_type" NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"issued_date" date,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"superseded_by_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"grantee_user_id" uuid,
	"grantee_role" "role_code",
	"permission" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dag_one_grantee" CHECK (("document_access_grants"."grantee_user_id" IS NULL) <> ("document_access_grants"."grantee_role" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "document_regulation_refs" (
	"document_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"note" text,
	CONSTRAINT "document_regulation_refs_document_id_article_id_pk" PRIMARY KEY("document_id","article_id")
);
--> statement-breakpoint
CREATE TABLE "document_types" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"locks_on_approval" boolean DEFAULT false NOT NULL,
	"is_generated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"content_json" jsonb,
	"storage_key" text,
	"mime_type" text,
	"size_bytes" bigint,
	"sha256" text NOT NULL,
	"change_note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_doc_version_uq" UNIQUE("document_id","version_no"),
	CONSTRAINT "document_versions_has_content" CHECK ("document_versions"."content_json" IS NOT NULL OR "document_versions"."storage_key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bdl_id" uuid NOT NULL,
	"document_type_code" text NOT NULL,
	"title" text NOT NULL,
	"period_id" uuid,
	"status" "document_status" DEFAULT 'DRAFT' NOT NULL,
	"current_version_no" integer DEFAULT 0 NOT NULL,
	"effective_date" date,
	"confidentiality" "confidentiality" DEFAULT 'RAHASIA' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_chain_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"label" text NOT NULL,
	"required_role" "role_code" NOT NULL,
	"scope" "approval_step_scope" DEFAULT 'SAME_DIVISION' NOT NULL,
	"is_gate" boolean DEFAULT false NOT NULL,
	"gate_code" text,
	"sla_days" integer DEFAULT 5 NOT NULL,
	CONSTRAINT "approval_chain_steps_order_uq" UNIQUE("template_id","step_order")
);
--> statement-breakpoint
CREATE TABLE "approval_chain_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"change_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "approval_matrix_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"change_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"document_type_code" text NOT NULL,
	"bdl_grade" "bdl_grade",
	"bank_type" "bank_type",
	"has_separatist_creditor" boolean,
	"threshold_basis" "threshold_basis" DEFAULT 'INSURED_DEPOSITS' NOT NULL,
	"threshold_min" numeric(20, 2),
	"threshold_max" numeric(20, 2),
	"threshold_param_key" text,
	"threshold_param_side" text,
	"requires_kap_audit" boolean DEFAULT false NOT NULL,
	"chain_template_code" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"regulation_article_id" uuid,
	"description" text,
	CONSTRAINT "amr_threshold_param_side" CHECK ("approval_matrix_rules"."threshold_param_side" IS NULL OR "approval_matrix_rules"."threshold_param_side" IN ('AT_OR_BELOW','ABOVE'))
);
--> statement-breakpoint
CREATE TABLE "approval_request_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_order" integer NOT NULL,
	"label" text NOT NULL,
	"required_role" "role_code" NOT NULL,
	"scope" "approval_step_scope" NOT NULL,
	"is_gate" boolean DEFAULT false NOT NULL,
	"gate_code" text,
	"status" "approval_step_status" DEFAULT 'WAITING' NOT NULL,
	"activated_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"acted_by" uuid,
	"acted_at" timestamp with time zone,
	"comment" text,
	CONSTRAINT "approval_request_steps_order_uq" UNIQUE("request_id","step_order")
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"document_version_no" integer NOT NULL,
	"matrix_rule_id" uuid NOT NULL,
	"chain_template_id" uuid NOT NULL,
	"resolution_context" jsonb NOT NULL,
	"status" "approval_request_status" DEFAULT 'PENDING' NOT NULL,
	"current_step_order" integer,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "system_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"change_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"regulation_article_id" uuid
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"change_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"label_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"account_class" "account_class" NOT NULL,
	"ppap_of_code" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lapan_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"change_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"section" "lapan_section" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bdl_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"entry_no" integer NOT NULL,
	"transaction_type_id" uuid NOT NULL,
	"transaction_type_code" text NOT NULL,
	"transaction_date" date NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"inputs" jsonb NOT NULL,
	"counterparty_type" "counterparty_type",
	"counterparty_name" text,
	"asset_ref" text,
	"evidence_ref" text,
	"evidence_document_id" uuid,
	"status" "entry_status" DEFAULT 'DRAFT' NOT NULL,
	"entry_kind" "entry_kind" DEFAULT 'NORMAL' NOT NULL,
	"corrects_entry_id" uuid,
	"correction_request_id" uuid,
	"origin_period_id" uuid,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"rejection_reason" text,
	CONSTRAINT "ledger_entries_bdl_no_uq" UNIQUE("bdl_id","entry_no"),
	CONSTRAINT "ledger_entries_maker_checker" CHECK ("ledger_entries"."verified_by" IS NULL OR "ledger_entries"."verified_by" <> "ledger_entries"."created_by"),
	CONSTRAINT "ledger_entries_rejection_reason" CHECK ("ledger_entries"."status" <> 'REJECTED' OR "ledger_entries"."rejection_reason" IS NOT NULL),
	CONSTRAINT "ledger_entries_reversal_ref" CHECK ("ledger_entries"."entry_kind" <> 'REVERSAL' OR "ledger_entries"."corrects_entry_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ledger_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bdl_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "period_status" DEFAULT 'OPEN' NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"approved_at" timestamp with time zone,
	"lapan_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_periods_bdl_start_uq" UNIQUE("bdl_id","period_start"),
	CONSTRAINT "ledger_periods_range" CHECK ("ledger_periods"."period_end" >= "ledger_periods"."period_start")
);
--> statement-breakpoint
CREATE TABLE "ledger_posting_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"lapan_line_code" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	"net_asset_effect" numeric(20, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "net_asset_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"account_code" text NOT NULL,
	"amount" numeric(20, 2) NOT NULL,
	CONSTRAINT "nasl_statement_account_uq" UNIQUE("statement_id","account_code")
);
--> statement-breakpoint
CREATE TABLE "net_asset_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bdl_id" uuid NOT NULL,
	"kind" "statement_kind" NOT NULL,
	"as_of_date" date NOT NULL,
	"status" "statement_status" DEFAULT 'DRAFT' NOT NULL,
	"document_id" uuid,
	"derived_from_statement_id" uuid,
	"source_period_id" uuid,
	"locked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "period_correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bdl_id" uuid NOT NULL,
	"target_period_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "correction_status" DEFAULT 'DRAFT' NOT NULL,
	"document_id" uuid,
	"window_until" timestamp with time zone,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"change_reason" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"input_schema" jsonb NOT NULL,
	"posting_rules" jsonb NOT NULL,
	"primary_amount_field" text NOT NULL,
	"requires_separatist_creditor" boolean DEFAULT false NOT NULL,
	"requires_counterparty" boolean DEFAULT false NOT NULL,
	"default_counterparty_type" "counterparty_type",
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_roles" text,
	"session_id" text,
	"request_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"bdl_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" text,
	"prev_hash" text,
	"hash" text
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_bdl_id_bdl_id_fk" FOREIGN KEY ("bdl_id") REFERENCES "public"."bdl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdl" ADD CONSTRAINT "bdl_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdl_events" ADD CONSTRAINT "bdl_events_bdl_id_bdl_id_fk" FOREIGN KEY ("bdl_id") REFERENCES "public"."bdl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdl_events" ADD CONSTRAINT "bdl_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdl_stage_history" ADD CONSTRAINT "bdl_stage_history_bdl_id_bdl_id_fk" FOREIGN KEY ("bdl_id") REFERENCES "public"."bdl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdl_stage_history" ADD CONSTRAINT "bdl_stage_history_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidation_team_members" ADD CONSTRAINT "liquidation_team_members_bdl_id_bdl_id_fk" FOREIGN KEY ("bdl_id") REFERENCES "public"."bdl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidation_team_members" ADD CONSTRAINT "liquidation_team_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidation_team_members" ADD CONSTRAINT "liquidation_team_members_legal_basis_article_id_regulation_articles_id_fk" FOREIGN KEY ("legal_basis_article_id") REFERENCES "public"."regulation_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulation_articles" ADD CONSTRAINT "regulation_articles_regulation_id_regulations_id_fk" FOREIGN KEY ("regulation_id") REFERENCES "public"."regulations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_regulation_refs" ADD CONSTRAINT "document_regulation_refs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_regulation_refs" ADD CONSTRAINT "document_regulation_refs_article_id_regulation_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."regulation_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_bdl_id_bdl_id_fk" FOREIGN KEY ("bdl_id") REFERENCES "public"."bdl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_document_type_code_document_types_code_fk" FOREIGN KEY ("document_type_code") REFERENCES "public"."document_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chain_steps" ADD CONSTRAINT "approval_chain_steps_template_id_approval_chain_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."approval_chain_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_rules" ADD CONSTRAINT "approval_matrix_rules_document_type_code_document_types_code_fk" FOREIGN KEY ("document_type_code") REFERENCES "public"."document_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_matrix_rules" ADD CONSTRAINT "approval_matrix_rules_regulation_article_id_regulation_articles_id_fk" FOREIGN KEY ("regulation_article_id") REFERENCES "public"."regulation_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request_steps" ADD CONSTRAINT "approval_request_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_request_steps" ADD CONSTRAINT "approval_request_steps_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_matrix_rule_id_approval_matrix_rules_id_fk" FOREIGN KEY ("matrix_rule_id") REFERENCES "public"."approval_matrix_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_chain_template_id_approval_chain_templates_id_fk" FOREIGN KEY ("chain_template_id") REFERENCES "public"."approval_chain_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_parameters" ADD CONSTRAINT "system_parameters_regulation_article_id_regulation_articles_id_fk" FOREIGN KEY ("regulation_article_id") REFERENCES "public"."regulation_articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bdl_id_bdl_id_fk" FOREIGN KEY ("bdl_id") REFERENCES "public"."bdl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_period_id_ledger_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."ledger_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_type_id_transaction_types_id_fk" FOREIGN KEY ("transaction_type_id") REFERENCES "public"."transaction_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_evidence_document_id_documents_id_fk" FOREIGN KEY ("evidence_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_correction_request_id_period_correction_requests_id_fk" FOREIGN KEY ("correction_request_id") REFERENCES "public"."period_correction_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_origin_period_id_ledger_periods_id_fk" FOREIGN KEY ("origin_period_id") REFERENCES "public"."ledger_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_periods" ADD CONSTRAINT "ledger_periods_bdl_id_bdl_id_fk" FOREIGN KEY ("bdl_id") REFERENCES "public"."bdl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_periods" ADD CONSTRAINT "ledger_periods_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_periods" ADD CONSTRAINT "ledger_periods_lapan_document_id_documents_id_fk" FOREIGN KEY ("lapan_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_posting_lines" ADD CONSTRAINT "ledger_posting_lines_entry_id_ledger_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_posting_lines" ADD CONSTRAINT "ledger_posting_lines_period_id_ledger_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."ledger_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_asset_statement_lines" ADD CONSTRAINT "net_asset_statement_lines_statement_id_net_asset_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."net_asset_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_asset_statements" ADD CONSTRAINT "net_asset_statements_bdl_id_bdl_id_fk" FOREIGN KEY ("bdl_id") REFERENCES "public"."bdl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_asset_statements" ADD CONSTRAINT "net_asset_statements_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_asset_statements" ADD CONSTRAINT "net_asset_statements_source_period_id_ledger_periods_id_fk" FOREIGN KEY ("source_period_id") REFERENCES "public"."ledger_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_asset_statements" ADD CONSTRAINT "net_asset_statements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_correction_requests" ADD CONSTRAINT "period_correction_requests_bdl_id_bdl_id_fk" FOREIGN KEY ("bdl_id") REFERENCES "public"."bdl"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_correction_requests" ADD CONSTRAINT "period_correction_requests_target_period_id_ledger_periods_id_fk" FOREIGN KEY ("target_period_id") REFERENCES "public"."ledger_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_correction_requests" ADD CONSTRAINT "period_correction_requests_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "period_correction_requests" ADD CONSTRAINT "period_correction_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ura_user_idx" ON "user_role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ura_bdl_idx" ON "user_role_assignments" USING btree ("bdl_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "bdl_division_idx" ON "bdl" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "bdl_events_bdl_idx" ON "bdl_events" USING btree ("bdl_id","occurred_at");--> statement-breakpoint
CREATE INDEX "bdl_stage_history_bdl_idx" ON "bdl_stage_history" USING btree ("bdl_id","entered_at");--> statement-breakpoint
CREATE INDEX "ltm_bdl_idx" ON "liquidation_team_members" USING btree ("bdl_id");--> statement-breakpoint
CREATE INDEX "ltm_active_idx" ON "liquidation_team_members" USING btree ("bdl_id") WHERE "liquidation_team_members"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "regulation_articles_reg_idx" ON "regulation_articles" USING btree ("regulation_id","article_ref");--> statement-breakpoint
CREATE INDEX "documents_bdl_idx" ON "documents" USING btree ("bdl_id","document_type_code");--> statement-breakpoint
CREATE INDEX "documents_period_idx" ON "documents" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "amr_doc_type_idx" ON "approval_matrix_rules" USING btree ("document_type_code");--> statement-breakpoint
CREATE INDEX "approval_request_steps_pending_idx" ON "approval_request_steps" USING btree ("status","required_role");--> statement-breakpoint
CREATE INDEX "approval_requests_doc_idx" ON "approval_requests" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "approval_requests_status_idx" ON "approval_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ledger_entries_period_idx" ON "ledger_entries" USING btree ("period_id","status");--> statement-breakpoint
CREATE INDEX "ledger_entries_bdl_date_idx" ON "ledger_entries" USING btree ("bdl_id","transaction_date");--> statement-breakpoint
CREATE INDEX "lpl_period_idx" ON "ledger_posting_lines" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "lpl_entry_idx" ON "ledger_posting_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "nas_bdl_idx" ON "net_asset_statements" USING btree ("bdl_id","kind","as_of_date");--> statement-breakpoint
CREATE INDEX "pcr_bdl_idx" ON "period_correction_requests" USING btree ("bdl_id");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_bdl_idx" ON "audit_log" USING btree ("bdl_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at");
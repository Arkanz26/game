@AGENTS.md

# SILIKA — project notes

- UI text is Bahasa Indonesia; code, identifiers and comments are English.
- All data access goes through services in `src/server/modules/*` that take an `AuthContext` and call
  `requireBdl`/`assertCan`. Pages and server actions stay thin (see `src/app/(app)/bdl/[bdlId]/actions.ts`).
- Money is `NUMERIC(20,2)` ↔ string; use `src/lib/money.ts` (Decimal), never JS numbers.
- Behaviour that varies per BDL profile or regulation belongs in versioned config tables
  (`approval_matrix_rules`, `transaction_types`, `accounts`, `lapan_line_items`, `system_parameters`), not in code.
  Config rows are immutable: close a version with `effective_to` and insert a new one.
- Domain invariants are also enforced by triggers in `drizzle/0001_invariants.sql`; new append-only tables need the
  same treatment. After schema changes run `pnpm db:generate`; custom SQL goes in a `--custom` migration.
- Checks: `pnpm lint && pnpm typecheck && pnpm test` (integration tests need `TEST_DATABASE_URL`, reset on each run);
  E2E: `pnpm db:setup && pnpm build && pnpm test:e2e`.

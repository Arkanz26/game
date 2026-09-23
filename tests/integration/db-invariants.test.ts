import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { audit } from "@/server/audit/audit";
import { getParameters } from "@/server/modules/config/effective";
import { freshDatabase } from "./helpers";

/** Invariants enforced by PostgreSQL itself — they hold even for writes that bypass the app. */
describe("database invariants", () => {
  beforeAll(async () => {
    await freshDatabase();
  });

  const expectDbError = async (p: Promise<unknown>, pattern: RegExp) => {
    await expect(p).rejects.toSatisfy((e: unknown) =>
      pattern.test(String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message)),
    );
  };

  it("audit log is append-only and hash-chained", async () => {
    for (let i = 0; i < 5; i++)
      await audit(db, null, { action: "test.event", entityType: "test", entityId: String(i), after: { i } });
    const [{ broken }] = await db.execute<{ broken: string | null }>(sql`select silika_audit_verify_chain() as broken`);
    expect(broken).toBeNull();
    const rows = await db.execute<{ prev_hash: string | null; hash: string }>(
      sql`select prev_hash, hash from audit_log order by id`,
    );
    for (let i = 1; i < rows.length; i++) expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
    await expectDbError(db.execute(sql`update audit_log set action = 'tampered'`), /append-only/);
    await expectDbError(db.execute(sql`delete from audit_log`), /append-only/);
  });

  it("configuration rows are immutable, non-overlapping and audited", async () => {
    await expectDbError(
      db.execute(sql`update system_parameters set value = '{"amount":"1"}' where code = 'KAP_AUDIT_THRESHOLD'`),
      /immutable/,
    );
    await expectDbError(db.execute(sql`delete from approval_matrix_rules`), /tidak boleh dihapus/);
    await expectDbError(
      db.execute(
        sql`insert into system_parameters (code, version, effective_from, value) values ('KAP_AUDIT_THRESHOLD', 2, '2025-01-01', '{"amount":"1"}')`,
      ),
      /no_overlap|conflicting key/,
    );

    // Proper change: close the current version and add a new one. Old dates keep resolving to the old rule.
    await db.execute(
      sql`update system_parameters set effective_to = '2027-01-01' where code = 'KAP_AUDIT_THRESHOLD' and effective_to is null`,
    );
    await db.execute(
      sql`insert into system_parameters (code, version, effective_from, value) values ('KAP_AUDIT_THRESHOLD', 2, '2027-01-01', '{"amount":"300000000000.00"}')`,
    );
    expect((await getParameters(db, "2026-06-30")).KAP_AUDIT_THRESHOLD.value).toEqual({ amount: "200000000000.00" });
    expect((await getParameters(db, "2027-02-01")).KAP_AUDIT_THRESHOLD.value).toEqual({ amount: "300000000000.00" });
    await expectDbError(
      db.execute(
        sql`update system_parameters set effective_to = '2028-01-01' where code = 'KAP_AUDIT_THRESHOLD' and version = 1`,
      ),
      /sudah ditutup/,
    );

    const [{ n }] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_log where entity_type = 'system_parameters' and action = 'config.update'`,
    );
    expect(n).toBe(1);
  });

  it("approval chain steps cannot be edited", async () => {
    await expectDbError(db.execute(sql`update approval_chain_steps set required_role = 'TL'`), /append-only/);
  });
});

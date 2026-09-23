import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { seedReference } from "@/server/db/seed/reference";
import { seedOrganisation } from "@/server/db/seed/demo";
import { loadAuthContext } from "@/server/auth/context";
import type { AuthContext } from "@/server/rbac/authorize";
import { addDays, todayWib } from "@/lib/dates";
import { resetDatabase } from "../../scripts/db-reset";

/** Fresh schema + reference config + organisation (no demo scenario). */
export async function freshDatabase() {
  await resetDatabase(process.env.DATABASE_URL!);
  await seedReference(db);
  return seedOrganisation();
}

export async function ctxFor(key: string): Promise<AuthContext> {
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.email, `${key}@silika.local`));
  return loadAuthContext({ id: u.id, name: u.name, email: u.email, divisionId: u.divisionId }, { requestId: "test" });
}

/** First day of the month `offset` months from today. */
export function monthStart(offset: number): string {
  const [y, m] = todayWib().split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}

export const monthDay = (offset: number, day: number) => addDays(monthStart(offset), day - 1);

/** Asserts a query is rejected by the database with a message matching `pattern` (Drizzle wraps the driver error in `cause`). */
export async function expectDbRejects(p: Promise<unknown>, pattern: RegExp) {
  let err: unknown;
  try {
    await p;
  } catch (e) {
    err = e;
  }
  if (!err) throw new Error(`Expected rejection matching ${pattern}`);
  const msg = String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message);
  if (!pattern.test(msg)) throw new Error(`Rejection "${msg}" does not match ${pattern}`);
}

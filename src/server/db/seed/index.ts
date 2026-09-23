import { sql } from "drizzle-orm";
import { db } from "../client";
import { seedReference } from "./reference";
import { seedDemoScenario, seedOrganisation } from "./demo";

export async function seedAll(opts: { scenario?: boolean } = {}) {
  const [{ n }] = await db.execute<{ n: number }>(sql`select count(*)::int as n from divisions`);
  if (n > 0) throw new Error("Database sudah berisi data; gunakan `pnpm db:reset` untuk memulai ulang");
  await seedReference(db);
  const org = await seedOrganisation();
  if (opts.scenario !== false) await seedDemoScenario(org);
  return org;
}

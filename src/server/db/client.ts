import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL belum di-set");
  return postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10), onnotice: () => {} });
}

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { silikaPg?: postgres.Sql };
export const pg = globalForDb.silikaPg ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.silikaPg = pg;

export const db = drizzle(pg, { schema });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
/** Anything that can run queries: the pool or an open transaction. */
export type Executor = DB | Tx;

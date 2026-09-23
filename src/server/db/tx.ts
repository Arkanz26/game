import { db, type Tx } from "./client";
import { setActor } from "@/server/audit/audit";
import type { AuthContext } from "@/server/rbac/authorize";

/** Runs `fn` in a transaction with the acting user exposed to database triggers. */
export function withTx<T>(ctx: AuthContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setActor(tx, ctx);
    return fn(tx);
  });
}

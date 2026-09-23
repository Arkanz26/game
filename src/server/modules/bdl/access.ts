import { eq } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { bdl } from "@/server/db/schema";
import { NotFoundError } from "@/server/errors";
import { assertCan, type AuthContext } from "@/server/rbac/authorize";
import type { Permission } from "@/server/rbac/permissions";

export type BdlRow = typeof bdl.$inferSelect;

export async function loadBdl(exec: Executor, bdlId: string): Promise<BdlRow> {
  const [row] = await exec.select().from(bdl).where(eq(bdl.id, bdlId));
  if (!row) throw new NotFoundError("BDL");
  return row;
}

/** Loads the BDL and asserts `permission` within the user's scope for it. */
export async function requireBdl(
  exec: Executor,
  ctx: AuthContext,
  permission: Permission,
  bdlId: string,
): Promise<BdlRow> {
  const row = await loadBdl(exec, bdlId);
  assertCan(ctx, permission, { bdlId: row.id, divisionId: row.divisionId });
  return row;
}

export const bdlTarget = (row: Pick<BdlRow, "id" | "divisionId">) => ({ bdlId: row.id, divisionId: row.divisionId });

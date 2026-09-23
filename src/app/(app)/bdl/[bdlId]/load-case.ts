import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { db } from "@/server/db/client";
import { getCase } from "@/server/modules/bdl/service";
import { ForbiddenError, type AuthContext } from "@/server/rbac/authorize";
import { NotFoundError } from "@/server/errors";

/** Loads the case (logging the read once per request); out-of-scope BDLs look like missing ones. */
export const loadCaseOr404 = cache(async (ctx: AuthContext, bdlId: string) => {
  try {
    return await getCase(db, ctx, bdlId);
  } catch (e) {
    if (e instanceof ForbiddenError || e instanceof NotFoundError) notFound();
    throw e;
  }
});

import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { rolePermissions, userRoleAssignments } from "@/server/db/schema";
import type { AuthContext, AuthUser, RoleAssignment } from "@/server/rbac/authorize";
import type { Permission, Role } from "@/server/rbac/permissions";
import { todayWib } from "@/lib/dates";

/** Builds the AuthContext for a user: active role assignments + role→permission map. */
export async function loadAuthContext(
  user: AuthUser,
  meta: Partial<Pick<AuthContext, "sessionId" | "ip" | "userAgent" | "requestId">> = {},
): Promise<AuthContext> {
  const today = todayWib();
  const assignments = await db
    .select({
      role: userRoleAssignments.role,
      scopeType: userRoleAssignments.scopeType,
      divisionId: userRoleAssignments.divisionId,
      bdlId: userRoleAssignments.bdlId,
    })
    .from(userRoleAssignments)
    .where(
      and(
        eq(userRoleAssignments.userId, user.id),
        lte(userRoleAssignments.validFrom, today),
        or(isNull(userRoleAssignments.validTo), gte(userRoleAssignments.validTo, today)),
      ),
    );
  const roleSet = [...new Set(assignments.map((a) => a.role))];
  const perms = roleSet.length
    ? await db
        .select()
        .from(rolePermissions)
        .where(sql`${rolePermissions.role} in ${roleSet}`)
    : [];
  const rolePerms = new Map<Role, Set<Permission>>();
  for (const p of perms) {
    if (!rolePerms.has(p.role)) rolePerms.set(p.role, new Set());
    rolePerms.get(p.role)!.add(p.permission as Permission);
  }
  return {
    user,
    assignments: assignments as RoleAssignment[],
    rolePermissions: rolePerms,
    sessionId: meta.sessionId ?? null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
    requestId: meta.requestId ?? null,
  };
}

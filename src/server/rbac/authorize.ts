import type { Permission, Role } from "./permissions";

export type ScopeType = "GLOBAL" | "DIVISION" | "BDL";

export type RoleAssignment = {
  role: Role;
  scopeType: ScopeType;
  divisionId: string | null;
  bdlId: string | null;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  divisionId: string | null;
};

/** Everything a service needs to authorise and audit an action. */
export type AuthContext = {
  user: AuthUser;
  assignments: RoleAssignment[];
  rolePermissions: Map<Role, Set<Permission>>;
  sessionId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
};

export type BdlTarget = { bdlId: string; divisionId: string };

export class ForbiddenError extends Error {
  constructor(message = "Anda tidak memiliki akses untuk tindakan ini") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function roles(ctx: AuthContext): Role[] {
  return [...new Set(ctx.assignments.map((a) => a.role))];
}

function roleHas(ctx: AuthContext, role: Role, permission: Permission): boolean {
  return ctx.rolePermissions.get(role)?.has(permission) ?? false;
}

export function assignmentCovers(a: RoleAssignment, target: BdlTarget): boolean {
  switch (a.scopeType) {
    case "GLOBAL":
      return true;
    case "DIVISION":
      return a.divisionId === target.divisionId;
    case "BDL":
      return a.bdlId === target.bdlId;
  }
}

/**
 * True when any of the user's role assignments grants `permission` and (if a target BDL is
 * given) its scope covers that BDL. Without a target, any assignment carrying the permission counts.
 */
export function can(ctx: AuthContext, permission: Permission, target?: BdlTarget): boolean {
  return ctx.assignments.some((a) => roleHas(ctx, a.role, permission) && (!target || assignmentCovers(a, target)));
}

export function assertCan(ctx: AuthContext, permission: Permission, target?: BdlTarget): void {
  if (!can(ctx, permission, target)) throw new ForbiddenError();
}

/** Whether the user holds `role` with a scope covering the BDL (used for approval steps). */
export function hasRoleFor(
  ctx: AuthContext,
  role: Role,
  target: BdlTarget,
  opts: { requireGlobal?: boolean } = {},
): boolean {
  return ctx.assignments.some(
    (a) =>
      a.role === role &&
      (opts.requireGlobal ? a.scopeType === "GLOBAL" : assignmentCovers(a, target)) &&
      roleHas(ctx, role, "approval.act"),
  );
}

export type BdlScopeFilter =
  { kind: "all" } | { kind: "some"; divisionIds: string[]; bdlIds: string[] } | { kind: "none" };

/** Which BDLs the user may see with `permission` — used to scope list queries. */
export function bdlScope(ctx: AuthContext, permission: Permission): BdlScopeFilter {
  const relevant = ctx.assignments.filter((a) => roleHas(ctx, a.role, permission));
  if (relevant.length === 0) return { kind: "none" };
  if (relevant.some((a) => a.scopeType === "GLOBAL")) return { kind: "all" };
  return {
    kind: "some",
    divisionIds: relevant.flatMap((a) => (a.scopeType === "DIVISION" && a.divisionId ? [a.divisionId] : [])),
    bdlIds: relevant.flatMap((a) => (a.scopeType === "BDL" && a.bdlId ? [a.bdlId] : [])),
  };
}

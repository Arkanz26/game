import { describe, expect, it } from "vitest";
import { bdlScope, can, hasRoleFor, type AuthContext, type RoleAssignment } from "@/server/rbac/authorize";
import { DEFAULT_ROLE_PERMISSIONS, type Permission, type Role } from "@/server/rbac/permissions";

function ctx(assignments: RoleAssignment[]): AuthContext {
  const rolePermissions = new Map<Role, Set<Permission>>(
    Object.entries(DEFAULT_ROLE_PERMISSIONS).map(([r, p]) => [r as Role, new Set(p)]),
  );
  return {
    user: { id: "u", name: "U", email: "u@x", divisionId: null },
    assignments,
    rolePermissions,
    sessionId: null,
    ip: null,
    userAgent: null,
    requestId: null,
  };
}
const bdlA = { bdlId: "A", divisionId: "D1" };
const bdlB = { bdlId: "B", divisionId: "D1" };
const bdlC = { bdlId: "C", divisionId: "D2" };

describe("RBAC", () => {
  it("TL is confined to its single BDL and cannot verify", () => {
    const tl = ctx([{ role: "TL", scopeType: "BDL", bdlId: "A", divisionId: null }]);
    expect(can(tl, "ledger.entry.create", bdlA)).toBe(true);
    expect(can(tl, "ledger.read", bdlB)).toBe(false);
    expect(can(tl, "ledger.entry.verify", bdlA)).toBe(false);
    expect(bdlScope(tl, "bdl.read")).toEqual({ kind: "some", divisionIds: [], bdlIds: ["A"] });
  });

  it("PIC verifies within its portfolio only", () => {
    const pic = ctx([
      { role: "PIC_GLIB", scopeType: "BDL", bdlId: "A", divisionId: null },
      { role: "PIC_GLIB", scopeType: "BDL", bdlId: "B", divisionId: null },
    ]);
    expect(can(pic, "ledger.entry.verify", bdlB)).toBe(true);
    expect(can(pic, "ledger.entry.verify", bdlC)).toBe(false);
  });

  it("Katim/Kadiv are division-scoped reviewers; Direktur is global", () => {
    const katim = ctx([{ role: "KATIM", scopeType: "DIVISION", divisionId: "D1", bdlId: null }]);
    expect(hasRoleFor(katim, "KATIM", bdlB)).toBe(true);
    expect(hasRoleFor(katim, "KATIM", bdlC)).toBe(false);
    expect(can(katim, "ledger.entry.create", bdlA)).toBe(false);
    const dir = ctx([{ role: "DIREKTUR_GROUP", scopeType: "GLOBAL", divisionId: null, bdlId: null }]);
    expect(hasRoleFor(dir, "DIREKTUR_GROUP", bdlC, { requireGlobal: true })).toBe(true);
    expect(hasRoleFor(katim, "KATIM", bdlB, { requireGlobal: true })).toBe(false);
    expect(bdlScope(dir, "bdl.read")).toEqual({ kind: "all" });
  });

  it("ADMIN manages configuration but cannot read case data", () => {
    const admin = ctx([{ role: "ADMIN", scopeType: "GLOBAL", divisionId: null, bdlId: null }]);
    expect(can(admin, "config.manage")).toBe(true);
    expect(can(admin, "bdl.read", bdlA)).toBe(false);
    expect(bdlScope(admin, "bdl.read")).toEqual({ kind: "none" });
  });
});

import type { AuthUser } from "@/server/rbac/authorize";

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; reason: "invalid" | "locked" | "inactive" };

/**
 * Identity providers only establish *who* the user is. Roles and scopes always come from
 * SILIKA's own user_role_assignments, so adding OIDC (LPS IdP) or LDAP/AD later does not
 * change RBAC — a provider maps its subject to a `users` row (auth_provider + external_subject).
 */
export interface AuthProvider {
  readonly id: "local" | "oidc" | "ldap";
  authenticate(credentials: { email: string; password: string }): Promise<AuthResult>;
}

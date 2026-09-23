import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  inet,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authProvider, roleCode, scopeType } from "./enums";
import { bdl } from "./bdl";

export const divisions = pgTable("divisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    nip: text("nip"),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    authProvider: authProvider("auth_provider").notNull().default("local"),
    externalSubject: text("external_subject"),
    divisionId: uuid("division_id").references(() => divisions.id),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`),
    check("users_local_requires_password", sql`${t.authProvider} <> 'local' OR ${t.passwordHash} IS NOT NULL`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 (hex) of the opaque session token; the raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Role → permission mapping. Seeded, editable by ADMIN; permission strings come from src/server/rbac/permissions.ts. */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    role: roleCode("role").notNull(),
    permission: text("permission").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.role, t.permission] })],
);

export const userRoleAssignments = pgTable(
  "user_role_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: roleCode("role").notNull(),
    scopeType: scopeType("scope_type").notNull(),
    divisionId: uuid("division_id").references(() => divisions.id),
    bdlId: uuid("bdl_id").references(() => bdl.id),
    validFrom: date("valid_from").notNull().defaultNow(),
    validTo: date("valid_to"),
    grantedBy: uuid("granted_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ura_user_idx").on(t.userId),
    index("ura_bdl_idx").on(t.bdlId),
    check(
      "ura_scope_target",
      sql`(${t.scopeType} = 'GLOBAL' AND ${t.divisionId} IS NULL AND ${t.bdlId} IS NULL)
        OR (${t.scopeType} = 'DIVISION' AND ${t.divisionId} IS NOT NULL AND ${t.bdlId} IS NULL)
        OR (${t.scopeType} = 'BDL' AND ${t.bdlId} IS NOT NULL AND ${t.divisionId} IS NULL)`,
    ),
  ],
);

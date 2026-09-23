import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { hashPassword, verifyPassword } from "../password";
import type { AuthProvider, AuthResult } from "./types";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Equalises timing when the e-mail does not exist.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("silika-timing-equaliser"));

export const localProvider: AuthProvider = {
  id: "local",
  async authenticate({ email, password }): Promise<AuthResult> {
    const [u] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email.trim()})`);
    if (!u || u.authProvider !== "local" || !u.passwordHash) {
      await verifyPassword(await getDummyHash(), password);
      return { ok: false, reason: "invalid" };
    }
    if (!u.isActive) return { ok: false, reason: "inactive" };
    if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) return { ok: false, reason: "locked" };

    if (!(await verifyPassword(u.passwordHash, password))) {
      const failed = u.failedLoginCount + 1;
      await db
        .update(users)
        .set({
          failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : u.lockedUntil,
        })
        .where(eq(users.id, u.id));
      return { ok: false, reason: failed >= MAX_FAILED ? "locked" : "invalid" };
    }
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, u.id));
    return { ok: true, user: { id: u.id, name: u.name, email: u.email, divisionId: u.divisionId } };
  },
};

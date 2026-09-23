import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";

export const SESSION_COOKIE = "silika_session";

const idleMinutes = () => Number(process.env.SESSION_IDLE_MINUTES ?? 30);
const absoluteHours = () => Number(process.env.SESSION_ABSOLUTE_HOURS ?? 8);

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, meta: { ip: string | null; userAgent: string | null }) {
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + absoluteHours() * 3_600_000);
  await db.insert(sessions).values({ id, userId, expiresAt, ip: meta.ip, userAgent: meta.userAgent });
  return { token, id, expiresAt };
}

export type ValidSession = {
  sessionId: string;
  user: { id: string; name: string; email: string; divisionId: string | null };
};

/** Validates a raw cookie token; enforces absolute expiry, idle timeout and revocation. */
export async function validateSessionToken(token: string): Promise<ValidSession | null> {
  const id = hashToken(token);
  const [row] = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      revokedAt: sessions.revokedAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      divisionId: users.divisionId,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id));
  if (!row || row.revokedAt || !row.isActive) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) return null;
  if (now - row.lastSeenAt.getTime() > idleMinutes() * 60_000) {
    await revokeSession(id);
    return null;
  }
  // Sliding idle window; avoid a write on every request.
  if (now - row.lastSeenAt.getTime() > 60_000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: new Date(now) })
      .where(eq(sessions.id, id));
  }
  return {
    sessionId: row.sessionId,
    user: { id: row.userId, name: row.name, email: row.email, divisionId: row.divisionId },
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

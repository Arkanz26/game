import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { loadAuthContext } from "./context";
import { SESSION_COOKIE, validateSessionToken } from "./session";
import type { AuthContext } from "@/server/rbac/authorize";

export async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  return {
    ip: ip && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
    requestId: h.get("x-request-id") ?? randomUUID(),
  };
}

/** The signed-in user's AuthContext for this request (memoised per request), or null. */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await validateSessionToken(token);
  if (!session) return null;
  const meta = await requestMeta();
  return loadAuthContext(session.user, { sessionId: session.sessionId, ...meta });
});

export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.SESSION_COOKIE_SECURE !== "false",
    sameSite: "strict" as const,
    path: "/",
    expires,
  };
}

"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db/client";
import { audit } from "@/server/audit/audit";
import { localProvider } from "@/server/auth/providers/local";
import { requestMeta, sessionCookieOptions } from "@/server/auth/request";
import { SESSION_COOKIE, createSession, hashToken, revokeSession } from "@/server/auth/session";

export type LoginState = { error?: string; email?: string } | null;

const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1) });

const MESSAGES = {
  invalid: "Email atau kata sandi salah.",
  locked: "Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam 15 menit.",
  inactive: "Akun tidak aktif. Hubungi administrator.",
};

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const email = typeof formData.get("email") === "string" ? String(formData.get("email")) : "";
  if (!parsed.success) return { error: "Isi email dan kata sandi dengan benar.", email };

  const meta = await requestMeta();
  const result = await localProvider.authenticate(parsed.data);
  if (!result.ok) {
    await audit(db, null, {
      action: "auth.login.failure",
      entityType: "user",
      after: { email: parsed.data.email, reason: result.reason, ip: meta.ip },
    });
    return { error: MESSAGES[result.reason], email };
  }
  const session = await createSession(result.user.id, meta);
  await audit(db, null, {
    action: "auth.login.success",
    entityType: "user",
    entityId: result.user.id,
    after: { sessionId: session.id, ip: meta.ip, userAgent: meta.userAgent },
  });
  (await cookies()).set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const id = hashToken(token);
    await revokeSession(id);
    await audit(db, null, { action: "auth.logout", entityType: "session", entityId: id });
  }
  store.delete(SESSION_COOKIE);
  redirect("/login");
}

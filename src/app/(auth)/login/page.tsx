import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/auth/request";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Masuk" };

const DEMO_ACCOUNTS: [string, string][] = [
  ["tl1@silika.local", "Tim Likuidasi — BDL-001"],
  ["pic1@silika.local", "PIC GLIB — BDL-001, BDL-002"],
  ["katim1@silika.local", "Kepala Tim — Divisi I"],
  ["kadiv1@silika.local", "Kepala Divisi — Divisi I"],
  ["pic2@silika.local", "PIC GLIB — BDL-003, BDL-004"],
  ["direktur@silika.local", "Direktur Group"],
  ["auditor@silika.local", "Auditor (read-only)"],
];

export default async function LoginPage() {
  if (await getAuthContext()) redirect("/dashboard");
  const showDemo = process.env.NODE_ENV !== "production" || process.env.SILIKA_SHOW_DEMO_ACCOUNTS === "true";
  return (
    <main className="flex min-h-screen items-center justify-center bg-primary px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center text-white">
          <div className="text-3xl font-bold tracking-tight">SILIKA</div>
          <div className="mt-1 text-sm text-white/75">Sistem Informasi Likuidasi Bank</div>
        </div>
        <div className="rounded-lg bg-surface p-6 shadow-xl">
          <h1 className="mb-4 text-base font-semibold">Masuk ke akun Anda</h1>
          <LoginForm />
          <p className="mt-4 text-xs text-muted">
            Sistem ini memuat data rahasia bank dalam likuidasi. Seluruh akses dicatat dalam audit trail.
          </p>
        </div>
        {showDemo && (
          <div className="mt-4 rounded-lg bg-white/10 p-4 text-xs text-white/85">
            <p className="font-semibold text-white">Akun demo (kata sandi: Silika#Dev2026)</p>
            <ul className="mt-2 space-y-0.5">
              {DEMO_ACCOUNTS.map(([email, role]) => (
                <li key={email}>
                  <span className="font-mono">{email}</span> — {role}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}

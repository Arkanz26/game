import { ForbiddenError } from "./rbac/authorize";

/** A business-rule violation whose message is safe to show to the user. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what = "Data") {
    super(`${what} tidak ditemukan`);
    this.name = "NotFoundError";
  }
}

function pgError(err: unknown): { code?: string; message?: string } | null {
  let e: unknown = err;
  // drizzle wraps driver errors in `cause`
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const candidate = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") return candidate as { code: string; message?: string };
    e = candidate.cause;
  }
  return null;
}

/**
 * Converts an error into a message for the UI. Invariant violations raised by database
 * triggers (prefixed "SILIKA:") are surfaced verbatim; anything unexpected is hidden.
 */
export function userMessage(err: unknown): string {
  if (err instanceof DomainError || err instanceof ForbiddenError) return err.message;
  const pg = pgError(err);
  if (pg?.message?.startsWith("SILIKA: ")) return pg.message.slice("SILIKA: ".length);
  if (pg?.code === "23505") return "Data yang sama sudah ada (duplikat).";
  if (pg?.code === "23514") return "Data melanggar aturan validasi basis data.";
  if (pg?.code === "23P01") return "Rentang tanggal tumpang tindih dengan data yang sudah ada.";
  console.error(err);
  return "Terjadi kesalahan sistem. Silakan hubungi administrator.";
}

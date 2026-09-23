import "server-only";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/server/auth/request";
import { userMessage } from "@/server/errors";
import { EntryValidationError } from "@/server/modules/ledger/entry.service";
import type { AuthContext } from "@/server/rbac/authorize";

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
  /** Echo of submitted values so forms can be re-populated after an error. */
  values?: Record<string, string>;
} | null;

/** Runs a mutation for the signed-in user, converting failures into a user-facing state. */
export async function runAction(
  fn: (ctx: AuthContext) => Promise<string | void>,
  opts: { values?: Record<string, string> } = {},
): Promise<ActionState> {
  const ctx = await requireAuth();
  try {
    const message = await fn(ctx);
    revalidatePath("/", "layout");
    return { ok: true, message: message ?? "Berhasil disimpan." };
  } catch (err) {
    if (err instanceof EntryValidationError) {
      return { ok: false, message: err.message, fieldErrors: err.fieldErrors, values: opts.values };
    }
    return { ok: false, message: userMessage(err), values: opts.values };
  }
}

export function formString(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$")) out[k] = v;
  return out;
}

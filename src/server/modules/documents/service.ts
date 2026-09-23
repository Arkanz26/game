import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Executor } from "@/server/db/client";
import { bdlEvents, documentVersions, documents } from "@/server/db/schema";
import { audit } from "@/server/audit/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import type { AuthContext } from "@/server/rbac/authorize";

/** Deterministic JSON (sorted keys) so a snapshot's hash is reproducible by auditors. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

export type DocumentRow = typeof documents.$inferSelect;

export async function loadDocument(exec: Executor, documentId: string): Promise<DocumentRow> {
  const [doc] = await exec.select().from(documents).where(eq(documents.id, documentId));
  if (!doc) throw new NotFoundError("Dokumen");
  return doc;
}

/** Creates a system-generated document with its first immutable version. */
export async function createGeneratedDocument(
  tx: Executor,
  ctx: AuthContext,
  input: {
    bdlId: string;
    documentTypeCode: string;
    title: string;
    periodId?: string | null;
    effectiveDate?: string | null;
    content: unknown;
    metadata?: Record<string, unknown>;
    changeNote?: string;
  },
): Promise<DocumentRow> {
  const [doc] = await tx
    .insert(documents)
    .values({
      bdlId: input.bdlId,
      documentTypeCode: input.documentTypeCode,
      title: input.title,
      periodId: input.periodId ?? null,
      effectiveDate: input.effectiveDate ?? null,
      metadata: input.metadata ?? {},
      createdBy: ctx.user.id,
      currentVersionNo: 1,
    })
    .returning();
  const hash = sha256Hex(canonicalJson(input.content));
  await tx.insert(documentVersions).values({
    documentId: doc.id,
    versionNo: 1,
    contentJson: input.content,
    sha256: hash,
    mimeType: "application/json",
    changeNote: input.changeNote ?? "Versi awal (digenerate sistem)",
    createdBy: ctx.user.id,
  });
  await audit(tx, ctx, {
    action: "document.create",
    entityType: "document",
    entityId: doc.id,
    bdlId: input.bdlId,
    after: { type: input.documentTypeCode, title: input.title, version: 1, sha256: hash },
  });
  return doc;
}

/** Adds a new immutable version to a document that is not under review or locked. */
export async function addGeneratedVersion(
  tx: Executor,
  ctx: AuthContext,
  doc: DocumentRow,
  content: unknown,
  changeNote: string,
): Promise<number> {
  if (doc.status === "IN_REVIEW") throw new DomainError("Dokumen sedang dalam proses persetujuan");
  if (doc.status === "LOCKED" || doc.status === "APPROVED" || doc.status === "SUPERSEDED") {
    throw new DomainError("Dokumen sudah disetujui/dikunci dan tidak dapat diubah");
  }
  const versionNo = doc.currentVersionNo + 1;
  const hash = sha256Hex(canonicalJson(content));
  await tx.insert(documentVersions).values({
    documentId: doc.id,
    versionNo,
    contentJson: content,
    sha256: hash,
    mimeType: "application/json",
    changeNote,
    createdBy: ctx.user.id,
  });
  await tx
    .update(documents)
    .set({ currentVersionNo: versionNo, status: "DRAFT", updatedAt: new Date() })
    .where(eq(documents.id, doc.id));
  await audit(tx, ctx, {
    action: "document.version",
    entityType: "document",
    entityId: doc.id,
    bdlId: doc.bdlId,
    after: { version: versionNo, sha256: hash, changeNote },
  });
  return versionNo;
}

export async function getCurrentVersion(exec: Executor, doc: Pick<DocumentRow, "id" | "currentVersionNo">) {
  const rows = await exec.select().from(documentVersions).where(eq(documentVersions.documentId, doc.id));
  return rows.find((v) => v.versionNo === doc.currentVersionNo) ?? null;
}

export async function recordEvent(
  tx: Executor,
  ctx: AuthContext | null,
  e: { bdlId: string; eventType: string; title: string; refEntityType?: string; refEntityId?: string },
) {
  await tx.insert(bdlEvents).values({ ...e, actorId: ctx?.user.id ?? null });
}

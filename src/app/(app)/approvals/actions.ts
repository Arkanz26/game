"use server";

import { formString, runAction, type ActionState } from "@/server/actions";
import { actOnStep } from "@/server/modules/approval/workflow.service";

export async function approvalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const decision = formString(fd, "decision") === "RETURN" ? "RETURN" : "APPROVE";
  return runAction(async (ctx) => {
    await actOnStep(ctx, formString(fd, "stepId"), {
      decision,
      comment: formString(fd, "comment"),
      gateEvidence: formString(fd, "gateEvidence"),
    });
    return decision === "APPROVE" ? "Disetujui" : "Dikembalikan ke pengaju";
  });
}

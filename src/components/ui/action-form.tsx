"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/server/actions";
import { buttonClass } from "./button";
import { cn } from "@/lib/cn";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** A form bound to a server action; shows the result message and optional confirmation. */
export function ActionForm({
  action,
  children,
  confirm,
  className,
  resetOnSuccess,
  hideMessage,
  id,
}: {
  id?: string;
  action: Action;
  children: React.ReactNode;
  confirm?: string;
  className?: string;
  resetOnSuccess?: boolean;
  hideMessage?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      id={id}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {!hideMessage && <ActionMessage state={state} />}
    </form>
  );
}

export function ActionMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={cn("mt-2 text-xs", state.ok ? "text-success" : "text-danger")}>
      {state.message}
    </p>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  name,
  value,
  className,
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost" | "success";
  size?: "sm" | "md";
  name?: string;
  value?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={buttonClass(variant, size, className)}
    >
      {pending ? "Memproses…" : children}
    </button>
  );
}

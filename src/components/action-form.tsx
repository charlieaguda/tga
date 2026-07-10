"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { ActionResult } from "@/lib/actions";

/**
 * Generic form wrapper for server actions with the (prevState, formData) signature.
 * Dispatches manually (preventDefault + startTransition) so React 19 does NOT
 * auto-reset the fields after a failed attempt — users keep what they typed.
 * On success the form is reset explicitly (unless resetOnSuccess is false).
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className,
  resetOnSuccess = true,
  disabled = false,
  disabledHint,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [state, dispatch, pending] = useActionState(
    async (prev: ActionResult, formData: FormData) => action(prev, formData),
    { ok: true } as ActionResult,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current && state.ok && resetOnSuccess && !pending) {
      formRef.current?.reset();
      submittedRef.current = false;
    }
  }, [state, pending, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      className={className ?? "flex flex-col gap-2"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!e.currentTarget.reportValidity()) return;
        const formData = new FormData(e.currentTarget);
        submittedRef.current = true;
        startTransition(() => dispatch(formData));
      }}
    >
      {children}
      {!state.ok && state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {disabled && disabledHint && <p className="text-sm text-amber-600">{disabledHint}</p>}
      <button
        type="submit"
        disabled={pending || disabled}
        className="cursor-pointer self-start rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

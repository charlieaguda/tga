"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";

const VARIANTS = {
  primary: "bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-700 hover:to-brand-600 text-white shadow-md shadow-brand-500/10 hover:shadow-brand-500/20 border border-brand-600/20",
  success: "bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white shadow-md shadow-emerald-500/10 hover:shadow-emerald-500/20 border border-emerald-600/20",
  danger: "bg-gradient-to-r from-red-600 to-red-500 hover:from-red-700 hover:to-red-600 text-white shadow-md shadow-red-500/10 hover:shadow-red-500/20 border border-red-600/20",
  neutral:
    "border border-slate-200/80 bg-white/50 text-slate-700 shadow-sm hover:bg-slate-100 dark:border-slate-800/85 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-slate-800/60",
} as const;

export function ActionButton({
  action,
  label,
  variant = "primary",
  confirm,
}: {
  action: () => Promise<ActionResult>;
  label: string;
  variant?: keyof typeof VARIANTS;
  confirm?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        className={`cursor-pointer rounded-xl px-3.5 py-2 text-sm font-semibold transition-all duration-255 hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]}`}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          startTransition(async () => {
            const res = await action();
            if (!res.ok) setError(res.error ?? "Failed");
          });
        }}
      >
        {pending ? "…" : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

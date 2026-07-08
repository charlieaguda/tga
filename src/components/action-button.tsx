"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";

const VARIANTS = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  danger: "bg-red-600 text-white hover:bg-red-700",
  neutral:
    "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800",
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
        className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${VARIANTS[variant]}`}
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

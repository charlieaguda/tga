"use client";

import { useEffect, useState } from "react";
import { categoryCreate } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800";

export function AddCategoryButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex items-center gap-2 text-xs font-medium text-slate-400 transition-colors hover:text-brand-600 dark:text-slate-500 dark:hover:text-brand-400"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-slate-300 transition-colors group-hover:border-brand-500 dark:border-slate-700">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </span>
        Add category
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Add category</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                ✕
              </button>
            </div>
            <ActionForm
              action={categoryCreate}
              submitLabel="Add category"
              className="flex flex-col gap-2"
              onSuccess={() => setOpen(false)}
            >
              <input name="label" required autoFocus placeholder="Category name" className={inputCls} />
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input type="checkbox" name="clientWritable" className="rounded" />
                Client can upload directly into this category
              </label>
            </ActionForm>
          </div>
        </div>
      )}
    </>
  );
}

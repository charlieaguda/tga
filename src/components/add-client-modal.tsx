"use client";

import { useEffect, useState } from "react";
import { clientCreate } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";

const inputCls =
  "rounded-xl border border-slate-200/80 bg-white/50 px-3.5 py-2 text-sm backdrop-blur-sm shadow-sm transition-all focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800/80 dark:bg-slate-900/50 dark:focus:border-brand-500 dark:focus:bg-slate-950";

export function AddClientModal({
  isAdmin,
  managers,
  editors,
}: {
  isAdmin: boolean;
  managers: { id: string; name: string }[];
  editors: { id: string; name: string }[];
}) {
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
        className="cursor-pointer rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-700 hover:to-brand-600 text-white shadow-md shadow-brand-500/10 hover:shadow-brand-500/20 border border-brand-600/20 px-4 py-2 text-sm font-semibold transition-all duration-255 hover:scale-[1.02] active:scale-[0.98]"
      >
        + Add client
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Add client</h3>
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
              action={clientCreate}
              submitLabel="Add client"
              className="flex flex-col gap-2"
              onSuccess={() => setOpen(false)}
            >
              <input name="name" required autoFocus placeholder="Client name" className={inputCls} />
              <textarea
                name="notes"
                rows={2}
                placeholder="Notes: handles, brand guidelines links… (optional)"
                className={inputCls}
              />
              {isAdmin && (
                <select name="defaultManagerId" defaultValue="" className={inputCls}>
                  <option value="">Default manager — none</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
              <select name="defaultEditorId" defaultValue="" className={inputCls}>
                <option value="">Default editor — none</option>
                {editors.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </ActionForm>
          </div>
        </div>
      )}
    </>
  );
}

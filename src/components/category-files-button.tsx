"use client";

import { useState } from "react";
import { ClientFileItem } from "@/components/client-file-item";
import { ClientFileUploader } from "@/components/file-drop-uploader";

interface ClientFile {
  id: string;
  driveFileId: string;
  storedName: string;
  sizeBytes: bigint | number;
  category: string | null;
  description: string | null;
  mimeType: string;
}

export function CategoryFilesButton({
  clientId,
  category,
  files,
  canEdit,
  canModify,
  categories,
  driveConfigured,
}: {
  clientId: string;
  category: { key: string; label: string };
  files: ClientFile[];
  canEdit: boolean;
  canModify: boolean;
  categories: { key: string; label: string }[];
  driveConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border border-slate-200/50 bg-white/50 p-3 text-left text-sm font-semibold text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-600 dark:border-slate-800/50 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:text-brand-400"
      >
        <span className="truncate pr-2">
          {category.label} ({files.length})
        </span>
        <svg className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {category.label} ({files.length})
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {files.length > 0 ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {files.map((f) => (
                    <ClientFileItem key={f.id} file={f} canEdit={canEdit} canModify={canModify} categories={categories} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-400 dark:text-slate-500 italic">No files uploaded yet.</p>
              )}
            </div>

            {canModify && driveConfigured && (
              <div className="border-t border-slate-100 pt-3 dark:border-slate-800/80">
                <ClientFileUploader clientId={clientId} category={category.key} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

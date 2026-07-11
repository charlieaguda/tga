"use client";

import { useState, useTransition } from "react";
import { updateFileDescription } from "@/lib/actions";
import { FileLink } from "@/components/ui";

interface ClientFile {
  id: string;
  driveFileId: string;
  storedName: string;
  sizeBytes: bigint | number;
  description: string | null;
}

export function ClientFileItem({
  file,
  canEdit,
}: {
  file: ClientFile;
  canEdit: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [description, setDescription] = useState(file.description);
  const [pending, startTransition] = useTransition();

  const getDriveViewLink = (driveFileId: string) => {
    return `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateFileDescription({ ok: true }, formData);
      if (res.ok) {
        setDescription(formData.get("description") as string);
        setIsEditing(false);
      } else {
        alert(res.error ?? "Failed to save description");
      }
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <FileLink
        href={getDriveViewLink(file.driveFileId)}
        name={file.storedName}
        sizeBytes={file.sizeBytes}
        description={isEditing ? null : description}
        extra={
          canEdit && (
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300 transition-colors"
              title="Edit description"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )
        }
      />
      {isEditing && (
        <form onSubmit={handleSave} className="mt-1 flex items-center gap-2 pl-6 animate-in fade-in slide-in-from-top-1 duration-200">
          <input type="hidden" name="fileId" value={file.id} />
          <input
            name="description"
            defaultValue={description ?? ""}
            placeholder="Add a description or note..."
            className="flex-1 rounded-lg border border-slate-200/80 bg-white/50 px-2.5 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-800/80 dark:bg-slate-900/50 dark:focus:border-brand-500"
            autoFocus
            disabled={pending}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-brand-600 hover:bg-brand-700 text-white px-2.5 py-1 text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setIsEditing(false)}
            disabled={pending}
            className="rounded-lg border border-slate-200/80 bg-white hover:bg-slate-50 px-2.5 py-1 text-xs font-semibold shadow-sm text-slate-700 dark:border-slate-800/80 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 transition-all"
          >
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

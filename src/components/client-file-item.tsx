"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateFileDescription, clientFileDelete, clientFileMove } from "@/lib/actions";
import { FileLink } from "@/components/ui";
import { FilePreviewModal } from "@/components/file-preview-modal";

interface ClientFile {
  id: string;
  driveFileId: string;
  storedName: string;
  sizeBytes: bigint | number;
  description: string | null;
  category: string | null;
  mimeType: string;
}

export function ClientFileItem({
  file,
  canEdit,
  canModify,
  categories,
}: {
  file: ClientFile;
  canEdit: boolean;
  canModify: boolean;
  categories: { key: string; label: string }[];
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [description, setDescription] = useState(file.description);
  const [showPreview, setShowPreview] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

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

  const handleDelete = () => {
    if (
      !window.confirm(
        `Delete "${file.storedName}"? It moves to Google Drive's own Trash, recoverable there for a while.`,
      )
    )
      return;
    setActionError(null);
    startTransition(async () => {
      const res = await clientFileDelete(file.id);
      if (!res.ok) setActionError(res.error ?? "Failed to delete");
      else router.refresh();
    });
  };

  const handleMove = (newCategoryKey: string) => {
    setActionError(null);
    startTransition(async () => {
      const res = await clientFileMove(file.id, newCategoryKey);
      if (!res.ok) setActionError(res.error ?? "Failed to move");
      else router.refresh();
    });
  };

  const otherCategories = categories.filter((c) => c.key !== file.category);

  return (
    <div
      className="flex flex-col gap-1"
      draggable={canModify}
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({ fileId: file.id, category: file.category }),
        );
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          className="shrink-0 overflow-hidden rounded-lg border border-slate-200/60 dark:border-slate-800/60"
          title="Preview"
        >
          {thumbFailed ? (
            <div className="flex h-10 w-10 items-center justify-center bg-slate-50 text-slate-400 dark:bg-slate-800/40 dark:text-slate-500">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
                <path d="M14 3v5h5" strokeLinejoin="round" />
              </svg>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/client-files/${file.id}/thumbnail`}
              alt=""
              className="h-10 w-10 object-cover"
              onError={() => setThumbFailed(true)}
            />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <FileLink
            href={getDriveViewLink(file.driveFileId)}
            name={file.storedName}
            sizeBytes={file.sizeBytes}
            description={isEditing ? null : description}
          />
        </div>
      </div>
      {(canEdit || canModify) && (
        <div className="flex flex-wrap items-center gap-1.5 pl-12">
          {canEdit && (
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
          )}
          {canModify && otherCategories.length > 0 && (
            <div className="relative inline-flex h-6 w-6 shrink-0" title="Move to another category">
              <select
                value=""
                disabled={pending}
                onChange={(e) => {
                  if (e.target.value) handleMove(e.target.value);
                }}
                className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              >
                <option value="">Move to…</option>
                {otherCategories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 peer-hover:bg-slate-100 peer-hover:text-slate-600 dark:text-slate-500 dark:peer-hover:bg-slate-800">
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h11m0 0l-4-4m4 4l-4 4M16 17H5m0 0l4 4m-4-4l4-4" />
                </svg>
              </div>
            </div>
          )}
          {canModify && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:text-slate-500 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
              title="Delete file"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 7h12M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m2 0v13a1 1 0 01-1 1H8a1 1 0 01-1-1V7h10Z"
                />
              </svg>
            </button>
          )}
        </div>
      )}
      {actionError && <p className="pl-12 text-xs text-red-600">{actionError}</p>}
      {isEditing && (
        <form onSubmit={handleSave} className="mt-1 flex items-center gap-2 pl-12 animate-in fade-in slide-in-from-top-1 duration-200">
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
      {showPreview && (
        <FilePreviewModal
          file={{ id: file.id, driveFileId: file.driveFileId, storedName: file.storedName, mimeType: file.mimeType }}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  );
}

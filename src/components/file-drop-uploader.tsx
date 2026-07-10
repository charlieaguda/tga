"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { FileCategory } from "@prisma/client";
import { uploadFileTo, validateFile } from "@/lib/upload-client";

type Progress = { file: File; pct: number; error?: string };

/**
 * Shared drag/drop + chunked-upload widget, upload-only (no submit step) —
 * used for client-hub category files and task reference attachments, which
 * (unlike editor deliverables) aren't gated behind a "submit for review" step.
 */
function FileDropUploader({
  label,
  initUrl,
  extraInitBody,
}: {
  label: string;
  initUrl: string;
  extraInitBody?: Record<string, unknown>;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  async function runUpload(index: number, file: File) {
    setItems((prev) => prev.map((p, j) => (j === index ? { ...p, error: undefined, pct: 0 } : p)));
    const error = await uploadFileTo(
      initUrl,
      file,
      (pct) => setItems((prev) => prev.map((p, j) => (j === index ? { ...p, pct } : p))),
      extraInitBody,
    );
    setItems((prev) =>
      prev.map((p, j) => (j === index ? { ...p, error: error ?? undefined, pct: error ? p.pct : 100 } : p)),
    );
    return error;
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const startIndex = items.length;
    setItems((prev) => [
      ...prev,
      ...list.map((file) => ({ file, pct: 0, error: validateFile(file) ?? undefined })),
    ]);
    setBusy(true);
    for (let i = 0; i < list.length; i++) {
      if (validateFile(list[i])) continue; // already flagged, skip network call
      await runUpload(startIndex + i, list[i]);
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  async function retry(index: number) {
    const item = items[index];
    if (!item) return;
    setBusy(true);
    const error = await runUpload(index, item.file);
    setBusy(false);
    if (!error) router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">{label}</label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col gap-1 rounded-md border-2 border-dashed p-3 ${
          isDragging ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-gray-300 dark:border-gray-600"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={busy}
          accept="video/*,image/*,application/pdf"
          onChange={(e) => handleFiles(e.target.files)}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
        />
        <p className="text-xs text-gray-400">or drag files here</p>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="max-w-60 truncate">{it.file.name}</span>
            {it.error ? (
              <>
                <span className="text-red-600">{it.error}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => retry(i)}
                  className="text-blue-600 underline hover:text-blue-700 disabled:opacity-50"
                >
                  Retry
                </button>
              </>
            ) : (
              <span className={it.pct === 100 ? "text-emerald-600" : "text-gray-500"}>
                {it.pct === 100 ? "✓ uploaded" : `${it.pct}%`}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ClientFileUploader({ clientId, category }: { clientId: string; category: FileCategory }) {
  return (
    <FileDropUploader
      label="Upload files (video / image / PDF, saved to Google Drive)"
      initUrl={`/api/clients/${clientId}/uploads`}
      extraInitBody={{ category }}
    />
  );
}

export function TaskAttachmentUploader({ taskId }: { taskId: string }) {
  return (
    <FileDropUploader
      label="Upload reference/example images (saved to Google Drive)"
      initUrl={`/api/tasks/${taskId}/attachments`}
    />
  );
}

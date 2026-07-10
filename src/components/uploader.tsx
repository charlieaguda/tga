"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { taskSubmit } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";
import { uploadFileTo, validateFile } from "@/lib/upload-client";

const inputCls =
  "rounded-xl border border-slate-200/80 bg-white/50 px-3.5 py-2 text-sm backdrop-blur-sm shadow-sm transition-all focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800/80 dark:bg-slate-900/50 dark:focus:border-brand-500 dark:focus:bg-slate-950";

type Progress = { file: File; pct: number; error?: string };

export function Uploader({ taskId, initialFileCount }: { taskId: string; initialFileCount: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const uploadedCount = items.filter((it) => it.pct === 100 && !it.error).length;
  const fileCount = initialFileCount + uploadedCount;

  async function runUpload(index: number, file: File) {
    setItems((prev) => prev.map((p, j) => (j === index ? { ...p, error: undefined, pct: 0 } : p)));
    const error = await uploadFileTo(
      `/api/tasks/${taskId}/uploads`,
      file,
      (pct) => setItems((prev) => prev.map((p, j) => (j === index ? { ...p, pct } : p))),
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
      <label className="text-sm font-medium">
        Upload deliverables (video / image / PDF, saved to Google Drive)
      </label>
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
        className={`flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-all ${
          isDragging ? "border-brand-500 bg-brand-500/5 dark:bg-brand-500/10" : "border-slate-200/80 bg-slate-50/20 hover:border-slate-350 dark:border-slate-800/80 dark:bg-slate-900/10 dark:hover:border-slate-700"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={busy}
          accept="video/*,image/*,application/pdf"
          onChange={(e) => handleFiles(e.target.files)}
          className="text-xs file:mr-3 file:cursor-pointer file:rounded-xl file:border-0 file:bg-brand-600 file:px-3.5 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-700 file:transition-colors file:shadow-sm"
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
      <ActionForm
        action={taskSubmit}
        submitLabel="Submit for review"
        disabled={fileCount === 0}
        disabledHint={fileCount === 0 ? "Upload at least one file before submitting." : undefined}
        className="flex max-w-md flex-col gap-2"
      >
        <input type="hidden" name="taskId" value={taskId} />
        <textarea
          name="note"
          rows={2}
          placeholder="What changed this round? (optional)"
          className={inputCls}
        />
      </ActionForm>
    </div>
  );
}

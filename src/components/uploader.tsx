"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const CHUNK = 16 * 1024 * 1024; // 16 MB — multiple of 256 KiB as Drive requires

type Progress = { name: string; pct: number; error?: string };

async function putChunk(sessionUri: string, file: File, start: number): Promise<Response> {
  const end = Math.min(start + CHUNK, file.size);
  return fetch(sessionUri, {
    method: "PUT",
    headers: { "Content-Range": `bytes ${start}-${end - 1}/${file.size}` },
    body: file.slice(start, end),
  });
}

/** Ask Drive how many bytes it has committed so an interrupted upload resumes. */
async function committedBytes(sessionUri: string, total: number): Promise<number> {
  const res = await fetch(sessionUri, {
    method: "PUT",
    headers: { "Content-Range": `bytes */${total}` },
  });
  if (res.status !== 308) return 0;
  const range = res.headers.get("range"); // "bytes=0-12345"
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

async function uploadOne(
  taskId: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<string | null> {
  // 1. Server authorizes and opens a Drive resumable session.
  const init = await fetch(`/api/tasks/${taskId}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
    }),
  });
  if (!init.ok) return (await init.json().catch(() => null))?.error ?? "Upload could not start";
  const { uploadId, sessionUri } = await init.json();

  // 2. Browser streams chunks straight to Google (bytes never touch our server).
  let start = 0;
  let driveFileId: string | null = null;
  let attempts = 0;
  while (start < file.size || (file.size === 0 && !driveFileId)) {
    const res = await putChunk(sessionUri, file, start).catch(() => null);
    if (res && (res.status === 200 || res.status === 201)) {
      driveFileId = (await res.json()).id;
      break;
    }
    if (res && res.status === 308) {
      start = Math.min(start + CHUNK, file.size);
      attempts = 0;
      onProgress(Math.round((start / file.size) * 100));
      continue;
    }
    // Interrupted — ask Drive where to resume from, up to 3 tries per stall.
    if (++attempts > 3) return "Upload failed after several retries — try again";
    await new Promise((r) => setTimeout(r, 1500 * attempts));
    start = await committedBytes(sessionUri, file.size).catch(() => start);
  }
  if (!driveFileId) return "Upload did not complete";

  // 3. Server verifies the file against Drive before recording it.
  const done = await fetch(`/api/uploads/${uploadId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ driveFileId }),
  });
  if (!done.ok) return (await done.json().catch(() => null))?.error ?? "Upload could not be confirmed";
  onProgress(100);
  return null;
}

export function Uploader({ taskId }: { taskId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    const list = Array.from(files);
    setItems(list.map((f) => ({ name: f.name, pct: 0 })));
    for (let i = 0; i < list.length; i++) {
      const error = await uploadOne(taskId, list[i], (pct) =>
        setItems((prev) => prev.map((p, j) => (j === i ? { ...p, pct } : p))),
      );
      if (error)
        setItems((prev) => prev.map((p, j) => (j === i ? { ...p, error } : p)));
    }
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">
        Upload deliverables (video / image / PDF, saved to Google Drive)
      </label>
      <input
        ref={inputRef}
        type="file"
        multiple
        disabled={busy}
        accept="video/*,image/*,application/pdf"
        onChange={(e) => handleFiles(e.target.files)}
        className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
      />
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="max-w-60 truncate">{it.name}</span>
            {it.error ? (
              <span className="text-red-600">{it.error}</span>
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

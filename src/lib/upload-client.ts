const CHUNK = 16 * 1024 * 1024; // 16 MB — multiple of 256 KiB as Drive requires
export const MAX_UPLOAD_SIZE = 5 * 1024 ** 3; // mirrors the server-side limit in upload-policy.ts

/** Client-side mirror of the server allow-list — instant feedback only, server stays authoritative. */
export function validateFile(file: File): string | null {
  if (file.size > MAX_UPLOAD_SIZE) return "File too large — max 5 GB";
  if (!(file.type.startsWith("video/") || file.type.startsWith("image/") || file.type === "application/pdf")) {
    return "Unsupported file type — video, image, or PDF only";
  }
  return null;
}

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

/**
 * Drive-resumable chunked upload, parameterized only by the init endpoint —
 * the complete endpoint is already entity-agnostic
 * (/api/uploads/[id]/complete dispatches by upload session type).
 */
export async function uploadFileTo(
  initUrl: string,
  file: File,
  onProgress: (pct: number) => void,
  extraInitBody?: Record<string, unknown>,
): Promise<string | null> {
  // 1. Server authorizes and opens a Drive resumable session.
  const init = await fetch(initUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
      ...extraInitBody,
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

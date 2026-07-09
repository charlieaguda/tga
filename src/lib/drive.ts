/**
 * Single entry point for all Google Drive access.
 * - Production: service account (JWT) auth from GOOGLE_SA_KEY_JSON (base64, server-only).
 * - Dev fallback: if GOOGLE_OAUTH_REFRESH_TOKEN is set (org policy blocking SA
 *   key creation, etc.), authenticate as a real Google user instead — same
 *   Shared Drive, same API calls below, only the credential source differs.
 *   Get a refresh token with `npx tsx scripts/get-drive-refresh-token.ts`.
 * - Every call goes through withBackoff(): exponential backoff + jitter on
 *   429 / 5xx / 403 rate-limit errors, and a process-wide concurrency cap.
 * - All calls set supportsAllDrives (files normally live in a Shared Drive;
 *   a service account has no My Drive quota of its own). Folder-lookup
 *   queries are always scoped by a known parent ID, so they work unchanged
 *   whether DRIVE_SHARED_DRIVE_ID points at a real Shared Drive (Workspace)
 *   or a plain folder in someone's My Drive (personal account, dev/testing).
 */
import { google, type drive_v3 } from "googleapis";

type DriveAuthClient = InstanceType<typeof google.auth.JWT> | InstanceType<typeof google.auth.OAuth2>;

// Despite the name, this may be a Shared Drive ID or a regular My Drive
// folder ID — see file header. Either way it's just "the root container
// to create Clients/... underneath."
const SHARED_DRIVE_ID = () => {
  const id = process.env.DRIVE_SHARED_DRIVE_ID;
  if (!id) throw new Error("DRIVE_SHARED_DRIVE_ID is not configured");
  return id;
};

let cached: { drive: drive_v3.Drive; auth: DriveAuthClient } | null = null;

function getDrive() {
  if (cached) return cached;

  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  let auth: DriveAuthClient;
  if (refreshToken) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured");
    const client = new google.auth.OAuth2(clientId, clientSecret);
    client.setCredentials({ refresh_token: refreshToken });
    auth = client;
  } else {
    const raw = process.env.GOOGLE_SA_KEY_JSON;
    if (!raw)
      throw new Error("Neither GOOGLE_SA_KEY_JSON nor GOOGLE_OAUTH_REFRESH_TOKEN is configured");
    const key = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  }
  cached = { drive: google.drive({ version: "v3", auth }), auth };
  return cached;
}

// ---------- backoff + concurrency ----------

const MAX_CONCURRENT = 4;
let inFlight = 0;
const queue: (() => void)[] = [];

async function acquire() {
  if (inFlight < MAX_CONCURRENT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => queue.push(resolve));
  inFlight++;
}

function release() {
  inFlight--;
  queue.shift()?.();
}

function isRetryable(err: unknown): boolean {
  const e = err as { code?: number | string; errors?: { reason?: string }[] };
  const code = Number(e?.code);
  if (code === 429 || (code >= 500 && code < 600)) return true;
  if (code === 403) {
    const reason = e?.errors?.[0]?.reason ?? "";
    return reason.includes("ateLimit"); // userRateLimitExceeded / rateLimitExceeded
  }
  return false;
}

export class DriveQuotaError extends Error {
  constructor() {
    super("Google Drive upload quota reached — try again later");
    this.name = "DriveQuotaError";
  }
}

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    let attempt = 0;
    // base 1s, factor 2, jitter, max 6 attempts (≤ ~64s worst case)
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        const e = err as { errors?: { reason?: string }[]; code?: number | string };
        // Daily upload cap is NOT retryable within a request — surface it.
        if (Number(e?.code) === 403 && e?.errors?.[0]?.reason === "storageQuotaExceeded")
          throw new DriveQuotaError();
        if (!isRetryable(err) || attempt >= 5) throw err;
        const delay = Math.min(1000 * 2 ** attempt, 32_000) * (0.5 + Math.random());
        await new Promise((r) => setTimeout(r, delay));
        attempt++;
      }
    }
  } finally {
    release();
  }
}

// ---------- folders ----------

const FOLDER_MIME = "application/vnd.google-apps.folder";

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Idempotent folder lookup-or-create under a parent (handles the
 * crash-after-create case by listing before creating). Returns the folder ID.
 */
export async function ensureFolder(parentId: string, name: string): Promise<string> {
  const { drive } = getDrive();
  // No driveId/corpora here: the query is already scoped by parentId, which
  // works identically whether that parent lives in a Shared Drive or a
  // regular My Drive folder. supportsAllDrives/includeItemsFromAllDrives are
  // harmless no-ops outside a Shared Drive.
  const existing = await withBackoff(() =>
    drive.files.list({
      q: `name = '${escapeQuery(name)}' and '${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: "files(id)",
      pageSize: 1,
    }),
  );
  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await withBackoff(() =>
    drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      supportsAllDrives: true,
      fields: "id",
    }),
  );
  return created.data.id as string;
}

export function sharedDriveRootId(): string {
  return SHARED_DRIVE_ID();
}

// ---------- files ----------

export type DriveFileInfo = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
};

export async function getFileInfo(fileId: string): Promise<DriveFileInfo | null> {
  const { drive } = getDrive();
  try {
    const res = await withBackoff(() =>
      drive.files.get({
        fileId,
        supportsAllDrives: true,
        fields: "id,name,size,mimeType,parents,appProperties,trashed",
      }),
    );
    if (res.data.trashed) return null;
    return {
      id: res.data.id as string,
      name: res.data.name ?? "",
      size: Number(res.data.size ?? 0),
      mimeType: res.data.mimeType ?? "",
      parents: res.data.parents ?? [],
      appProperties: (res.data.appProperties ?? {}) as Record<string, string>,
    };
  } catch (err) {
    if (Number((err as { code?: number }).code) === 404) return null;
    throw err;
  }
}

/**
 * Start a Drive resumable upload session and return the session URI.
 * The URI is a bearer capability scoped to creating this one file — it is
 * returned to the uploading editor only and never logged.
 */
export async function createResumableSession(input: {
  folderId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  appProperties: Record<string, string>;
}): Promise<string> {
  const { auth } = getDrive();
  const { token } = await auth.getAccessToken();
  if (!token) throw new Error("Failed to obtain Drive access token");

  return withBackoff(async () => {
    const res = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": input.mimeType,
          "X-Upload-Content-Length": String(input.sizeBytes),
          // Drive only enables CORS on the resulting session URI for the
          // origin present on THIS request. The browser makes the follow-up
          // chunk PUTs directly, so without this header those PUTs are
          // rejected cross-origin even though this init call itself is
          // server-to-server.
          Origin: process.env.AUTH_URL ?? "http://localhost:3000",
        },
        body: JSON.stringify({
          name: input.fileName,
          parents: [input.folderId],
          appProperties: input.appProperties,
        }),
      },
    );
    if (!res.ok) {
      const err = new Error(`Resumable session init failed: ${res.status}`) as Error & {
        code: number;
      };
      err.code = res.status;
      throw err;
    }
    const location = res.headers.get("location");
    if (!location) throw new Error("Resumable session init returned no location header");
    return location;
  });
}

/** Find a file by an appProperties entry (used by reconciliation to re-link orphans). */
export async function findFileByAppProperty(key: string, value: string): Promise<string | null> {
  const { drive } = getDrive();
  const res = await withBackoff(() =>
    drive.files.list({
      q: `appProperties has { key='${escapeQuery(key)}' and value='${escapeQuery(value)}' } and trashed = false`,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      fields: "files(id)",
      pageSize: 1,
    }),
  );
  return res.data.files?.[0]?.id ?? null;
}

/** Public viewer link — staff have read access to the Shared Drive via group membership. */
export function driveViewLink(driveFileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(driveFileId)}/view`;
}

export function isDriveConfigured(): boolean {
  const hasCredential = !!process.env.GOOGLE_SA_KEY_JSON || !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  return hasCredential && !!process.env.DRIVE_SHARED_DRIVE_ID;
}

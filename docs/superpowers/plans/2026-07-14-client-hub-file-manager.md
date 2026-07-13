# Client Hub File Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preview, drag-and-drop move between categories, delete, and month-based auto-arrange to client hub file uploads, per `docs/superpowers/specs/2026-07-14-client-hub-file-manager-design.md`.

**Architecture:** All Drive access stays funneled through `src/lib/drive.ts` (new `moveFile`/`trashFile`/`getFileParents`/`fetchThumbnail`/`fetchFileContent` exports, same `withBackoff` plumbing as everything else there). All mutations stay in `src/lib/services/client-files.ts`, reusing the existing `client.file.upload` permission for delete/move (no new permission rule). Two new authenticated proxy API routes stream thumbnail/content bytes server-side so no viewer needs their own Google login. UI changes are additive to the existing `ClientFileItem`/`client-hub-accordion.tsx`/`client-hub/[id]/page.tsx` — a new shared `CategoryDropZone` component is the only new UI abstraction, because it's genuinely identical logic reused on both surfaces.

**Tech Stack:** Next.js App Router route handlers, Prisma, `googleapis` (already a dependency), plain HTML5 drag-and-drop (no new dependency).

## Global Constraints

- This repo has no unit test runner (`package.json` has no `test` script, no jest/vitest). Verification convention is `npx tsc --noEmit` + `npm run lint`, plus manual verification against the local dev Postgres (`npm run dev:db`, port 5502) and dev server (`npm run dev`, port 3030) — the same pattern used throughout this session. Each task below replaces the skill template's "write failing test" steps with this project's real equivalent: a concrete `npx tsx -e '...'` DB-inspection snippet, a `curl` against the dev server, or a short throwaway Playwright script under `scripts/tmp-*.ts` (deleted immediately after use, per this session's established pattern).
- **The dev DB has a real Drive connection** (`dreau@thegrowthacademy.com.au`, confirmed earlier this session) — it is not a sandbox. Any verification step that actually uploads/moves/deletes a file against Drive needs the user's explicit go-ahead first, exactly as done earlier in this session. Steps that only exercise TypeScript/DB logic without touching Drive need no such check.
- Follow existing code style exactly: no comments explaining *what* code does, only non-obvious *why*; match existing Tailwind class patterns; services always `authorize()` before mutating; `ActivityLog` is append-only.
- Never commit without running `npx tsc --noEmit` and `npm run lint` clean first.

---

### Task 1: Drive layer — move, trash, and content-proxy helpers

**Files:**
- Modify: `src/lib/drive.ts:16` (add `import { Readable } from "node:stream";`), and append new exports after `moveFolder` (~line 196) and after `findFileByAppProperty` (~line 300).

**Interfaces:**
- Consumes: existing `getDrive()`, `withBackoff()` internal to this file.
- Produces (for later tasks):
  - `moveFile(fileId: string, addParentId: string, removeParentId: string): Promise<void>`
  - `trashFile(fileId: string): Promise<void>` — resolves normally even if the file is already gone (404 treated as success).
  - `getFileParents(fileId: string): Promise<string[]>`
  - `fetchThumbnail(fileId: string): Promise<{ body: ReadableStream; contentType: string } | null>` — `null` means Drive has no thumbnail for this file.
  - `fetchFileContent(fileId: string): Promise<{ body: ReadableStream; contentType: string; sizeBytes: number }>`

- [ ] **Step 1: Add the `node:stream` import**

In `src/lib/drive.ts`, change line 16 from:
```ts
import { google, type drive_v3 } from "googleapis";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/credential-crypto";
```
to:
```ts
import { google, type drive_v3 } from "googleapis";
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/credential-crypto";
```

- [ ] **Step 2: Add `moveFile` and `getFileParents` right after `moveFolder`**

Find this existing function (around line 180-196):
```ts
/** Re-parent a folder (used by client offboarding to move it under "Archive"). */
export async function moveFolder(
  folderId: string,
  fromParentId: string,
  toParentId: string,
): Promise<void> {
  const { drive } = await getDrive();
  await withBackoff(() =>
    drive.files.update({
      fileId: folderId,
      addParents: toParentId,
      removeParents: fromParentId,
      supportsAllDrives: true,
      fields: "id,parents",
    }),
  );
}
```
Immediately after it, add:
```ts

/** Re-parent a file (used to move a client-hub file between category folders). */
export async function moveFile(
  fileId: string,
  addParentId: string,
  removeParentId: string,
): Promise<void> {
  const { drive } = await getDrive();
  await withBackoff(() =>
    drive.files.update({
      fileId,
      addParents: addParentId,
      removeParents: removeParentId,
      supportsAllDrives: true,
      fields: "id,parents",
    }),
  );
}

/** Files inside a Shared Drive have exactly one parent — used to find the
 * folder to remove-from before adding the new one in moveFile. */
export async function getFileParents(fileId: string): Promise<string[]> {
  const { drive } = await getDrive();
  const res = await withBackoff(() =>
    drive.files.get({ fileId, supportsAllDrives: true, fields: "parents" }),
  );
  return res.data.parents ?? [];
}

/** Move a file to Drive's own Trash (recoverable there, not a permanent delete). */
export async function trashFile(fileId: string): Promise<void> {
  const { drive } = await getDrive();
  try {
    await withBackoff(() =>
      drive.files.update({
        fileId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
        fields: "id",
      }),
    );
  } catch (err) {
    if (Number((err as { code?: number }).code) === 404) return;
    throw err;
  }
}
```

- [ ] **Step 3: Add `fetchThumbnail` and `fetchFileContent` right after `findFileByAppProperty`**

Find this existing function (around line 288-300):
```ts
/** Find a file by an appProperties entry (used by reconciliation to re-link orphans). */
export async function findFileByAppProperty(key: string, value: string): Promise<string | null> {
  const { drive } = await getDrive();
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
```
Immediately after it, add:
```ts

/**
 * Fetch a small preview image for a file, authenticated with our own
 * service credentials — never the viewer's own Google session, so this
 * works for CLIENT-role users too. Returns null if Drive has no thumbnail
 * for this mimeType (caller falls back to a generic icon).
 */
export async function fetchThumbnail(
  fileId: string,
): Promise<{ body: ReadableStream; contentType: string } | null> {
  const { drive, auth } = await getDrive();
  const meta = await withBackoff(() =>
    drive.files.get({ fileId, supportsAllDrives: true, fields: "thumbnailLink" }),
  );
  const thumbnailLink = meta.data.thumbnailLink;
  if (!thumbnailLink) return null;

  const { token } = await auth.getAccessToken();
  const res = await fetch(thumbnailLink, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
  if (!res.ok || !res.body) return null;
  return { body: res.body, contentType: res.headers.get("content-type") ?? "image/jpeg" };
}

/** Stream a file's actual bytes, for in-app image/PDF preview (video preview
 * uses Drive's own embeddable player instead — see FilePreviewModal). */
export async function fetchFileContent(
  fileId: string,
): Promise<{ body: ReadableStream; contentType: string; sizeBytes: number }> {
  const { drive } = await getDrive();
  const meta = await withBackoff(() =>
    drive.files.get({ fileId, supportsAllDrives: true, fields: "mimeType,size" }),
  );
  const res = await withBackoff(() =>
    drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "stream" }),
  );
  return {
    body: Readable.toWeb(res.data as NodeJS.ReadableStream) as ReadableStream,
    contentType: meta.data.mimeType ?? "application/octet-stream",
    sizeBytes: Number(meta.data.size ?? 0),
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Commit**

```bash
git add src/lib/drive.ts
git commit -m "$(cat <<'EOF'
feat: add move/trash/content-proxy Drive helpers

Foundation for client-hub file delete, move-between-categories, and
in-app preview — no caller wired up yet.
EOF
)"
```

---

### Task 2: Auto-arrange uploads by month + shared editor-task-scope helper

**Files:**
- Modify: `src/lib/services/client-files.ts` (imports at top, `getUploadableClient` ~line 53-69, `createClientUploadSession` ~line 71-107, `completeClientUpload` ~line 122-148).

**Interfaces:**
- Consumes: `ensureFolder` from `@/lib/drive` (already imported in this file), `SessionUser` type from `@/lib/permissions`.
- Produces (for Tasks 3 and 4): `resolveEditorHasTask(user: SessionUser, clientId: string): Promise<boolean | undefined>` (module-private, not exported — Tasks 3/4 land in this same file).

- [ ] **Step 1: Import `SessionUser` type**

Change the top of `src/lib/services/client-files.ts` from:
```ts
import type { Category, Client, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize, requireUser } from "@/lib/permissions";
```
to:
```ts
import type { Category, Client, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize, requireUser, type SessionUser } from "@/lib/permissions";
```

- [ ] **Step 2: Add `resolveEditorHasTask` and `currentMonthLabel` helpers**

Immediately after the `ensureClientCategoryFolder` function (ends ~line 51, right before `async function getUploadableClient`), add:
```ts

async function resolveEditorHasTask(user: SessionUser, clientId: string): Promise<boolean | undefined> {
  if (user.role !== "EDITOR") return undefined;
  return (await db.task.count({ where: { assigneeId: user.id, job: { clientId } } })) > 0;
}

function currentMonthLabel(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
```

- [ ] **Step 3: Use the helper in `getUploadableClient`**

Change:
```ts
async function getUploadableClient(clientId: string, categoryKey: string) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const category = await db.category.findUnique({ where: { key: categoryKey } });
  if (!category) throw new ValidationError("Unknown file category");

  const user = await requireUser();
  const editorHasTask =
    user.role === "EDITOR"
      ? (await db.task.count({ where: { assigneeId: user.id, job: { clientId } } })) > 0
      : undefined;

  const actor = await authorize("client.file.upload", { client, category, editorHasTask });
  if (!client.isActive || client.offboardedAt)
    throw new ConflictError("This client is offboarded — uploads are disabled");
  return { client, category, actor };
}
```
to:
```ts
async function getUploadableClient(clientId: string, categoryKey: string) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const category = await db.category.findUnique({ where: { key: categoryKey } });
  if (!category) throw new ValidationError("Unknown file category");

  const user = await requireUser();
  const editorHasTask = await resolveEditorHasTask(user, clientId);

  const actor = await authorize("client.file.upload", { client, category, editorHasTask });
  if (!client.isActive || client.offboardedAt)
    throw new ConflictError("This client is offboarded — uploads are disabled");
  return { client, category, actor };
}
```

- [ ] **Step 4: Route new uploads into a month subfolder**

Change, in `createClientUploadSession`:
```ts
  const { client, category, actor } = await getUploadableClient(clientId, categoryKey);
  const folderId = await ensureClientCategoryFolder(client, category);
```
to:
```ts
  const { client, category, actor } = await getUploadableClient(clientId, categoryKey);
  const categoryFolderId = await ensureClientCategoryFolder(client, category);
  const folderId = await ensureFolder(categoryFolderId, currentMonthLabel());
```

- [ ] **Step 5: Use the helper in `completeClientUpload`**

Change:
```ts
  const category = await db.category.findUnique({ where: { key: session.category } });
  if (!category) throw new ValidationError("Unknown file category");
  const user = await requireUser();
  const editorHasTask =
    user.role === "EDITOR"
      ? (await db.task.count({ where: { assigneeId: user.id, job: { clientId: session.client.id } } })) > 0
      : undefined;
  const actor = await authorize("client.file.upload", {
    client: session.client,
    category,
    editorHasTask,
  });
```
to:
```ts
  const category = await db.category.findUnique({ where: { key: session.category } });
  if (!category) throw new ValidationError("Unknown file category");
  const user = await requireUser();
  const editorHasTask = await resolveEditorHasTask(user, session.client.id);
  const actor = await authorize("client.file.upload", {
    client: session.client,
    category,
    editorHasTask,
  });
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 7: Manual verification (no Drive upload needed — inspect the destination logic directly)**

Confirm `ensureFolder` is called with a month-labeled name by reading the change back:
```bash
grep -n "currentMonthLabel\|ensureFolder(categoryFolderId" src/lib/services/client-files.ts
```
Expected output includes both the `createClientUploadSession` call site and the `currentMonthLabel` function definition.

If you want to confirm end-to-end against real Drive (creates a real dated subfolder under whichever category you pick) — **ask the user first**, then reuse the exact upload-test pattern from earlier this session (login as `editor1`/`password123` via Playwright, upload through the dashboard accordion, then check the new file's Drive parent folder name matches `YYYY-MM`).

- [ ] **Step 8: Commit**

```bash
git add src/lib/services/client-files.ts
git commit -m "$(cat <<'EOF'
feat: auto-arrange client-hub uploads into month subfolders

New uploads land in a YYYY-MM subfolder inside their category's Drive
folder instead of directly in it. Existing files are untouched — this
only changes where new uploads go. Also extracts resolveEditorHasTask
so the upcoming delete/move service functions don't duplicate the
task-count check a third and fourth time.
EOF
)"
```

---

### Task 3: Delete a client-hub file

**Files:**
- Modify: `src/lib/services/client-files.ts` — add `import { moveFile, trashFile, getFileParents } from "@/lib/drive";` alongside the existing drive import block, and a new exported `deleteClientFile` function.
- Modify: `src/lib/actions.ts` — add `clientFileDelete` action at the end of the file.

**Interfaces:**
- Consumes: `trashFile` (Task 1), `resolveEditorHasTask` (Task 2), existing `authorize`, `logActivity`.
- Produces (for Task 9's UI): `clientFileDelete(fileId: string): Promise<ActionResult>` exported from `@/lib/actions`.

- [ ] **Step 1: Add the Drive import**

In `src/lib/services/client-files.ts`, change:
```ts
import {
  createResumableSession,
  ensureFolder,
  findFileByAppProperty,
  isDriveConfigured,
  sharedDriveRootId,
} from "@/lib/drive";
```
to:
```ts
import {
  createResumableSession,
  ensureFolder,
  findFileByAppProperty,
  isDriveConfigured,
  sharedDriveRootId,
  trashFile,
} from "@/lib/drive";
```
(Only `trashFile` — Task 3 doesn't need `moveFile`/`getFileParents`. Task 4 adds those two imports itself when it actually uses them, avoiding an unused-import lint warning in between.)

- [ ] **Step 2: Add `deleteClientFile`**

Append at the end of `src/lib/services/client-files.ts` (after `updateClientFileDescription`):
```ts

export async function deleteClientFile(fileId: string): Promise<void> {
  const file = await db.file.findUnique({ where: { id: fileId } });
  if (!file || !file.clientId || !file.category) throw new ValidationError("File not found");

  const client = await db.client.findUniqueOrThrow({ where: { id: file.clientId } });
  const category = await db.category.findUniqueOrThrow({ where: { key: file.category } });

  const user = await requireUser();
  const editorHasTask = await resolveEditorHasTask(user, client.id);
  const actor = await authorize("client.file.upload", { client, category, editorHasTask });

  await trashFile(file.driveFileId);
  await db.file.delete({ where: { id: fileId } });
  await logActivity(db, {
    actorId: actor.id,
    action: "file.deleted",
    entityType: "file",
    entityId: file.id,
    clientId: client.id,
    meta: { name: file.storedName, category: file.category },
  });
}
```

- [ ] **Step 3: Add the `clientFileDelete` action**

Append at the end of `src/lib/actions.ts` (after `updateFileDescription`):
```ts

export async function clientFileDelete(fileId: string): Promise<ActionResult> {
  return guard(() => clientFiles.deleteClientFile(id.parse(fileId)));
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Manual verification against the local dev DB (no Drive call — dry-run the guard clauses)**

With the dev DB running (`npm run dev:db`), confirm the not-found guard behaves correctly without touching Drive:
```bash
npx tsx -e '
import { deleteClientFile } from "./src/lib/services/client-files";
deleteClientFile("does-not-exist").catch((e) => console.log("expected error:", e.message));
'
```
Expected output: `expected error: ...` — but note this will actually throw at `requireUser()` first (`UnauthorizedError: Not signed in`) since this script runs outside a request context with no session. That's fine — it confirms the function is wired and reachable; full auth+Drive verification happens via the dev server in Task 12.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/client-files.ts src/lib/actions.ts
git commit -m "$(cat <<'EOF'
feat: add client-hub file deletion

Trashes the Drive file (recoverable in Drive's own Trash) and removes
the File row. Same permission rule as upload — no new policy needed.
No UI wired up yet.
EOF
)"
```

---

### Task 4: Move a client-hub file between categories

**Files:**
- Modify: `src/lib/services/client-files.ts` — add `moveClientFile`.
- Modify: `src/lib/actions.ts` — add `clientFileMove`.

**Interfaces:**
- Consumes: `moveFile`, `getFileParents` (Task 1), `ensureClientCategoryFolder`, `ensureFolder`, `currentMonthLabel`, `resolveEditorHasTask` (all already in this file).
- Produces (for Task 9's UI): `clientFileMove(fileId: string, newCategoryKey: string): Promise<ActionResult>` exported from `@/lib/actions`.

- [ ] **Step 1: Add `moveFile`/`getFileParents` to the Drive import**

In `src/lib/services/client-files.ts`, change:
```ts
import {
  createResumableSession,
  ensureFolder,
  findFileByAppProperty,
  isDriveConfigured,
  sharedDriveRootId,
  trashFile,
} from "@/lib/drive";
```
to:
```ts
import {
  createResumableSession,
  ensureFolder,
  findFileByAppProperty,
  getFileParents,
  isDriveConfigured,
  moveFile,
  sharedDriveRootId,
  trashFile,
} from "@/lib/drive";
```

- [ ] **Step 2: Add `moveClientFile`**

Append at the end of `src/lib/services/client-files.ts` (after `deleteClientFile`):
```ts

export async function moveClientFile(fileId: string, newCategoryKey: string): Promise<void> {
  const file = await db.file.findUnique({ where: { id: fileId } });
  if (!file || !file.clientId || !file.category) throw new ValidationError("File not found");
  if (file.category === newCategoryKey) throw new ValidationError("File is already in that category");

  const client = await db.client.findUniqueOrThrow({ where: { id: file.clientId } });
  const oldCategory = await db.category.findUniqueOrThrow({ where: { key: file.category } });
  const newCategory = await db.category.findUnique({ where: { key: newCategoryKey } });
  if (!newCategory) throw new ValidationError("Unknown file category");

  const user = await requireUser();
  const editorHasTask = await resolveEditorHasTask(user, client.id);
  await authorize("client.file.upload", { client, category: oldCategory, editorHasTask });
  const actor = await authorize("client.file.upload", { client, category: newCategory, editorHasTask });

  const parents = await getFileParents(file.driveFileId);
  const currentParent = parents[0];
  if (!currentParent) throw new ValidationError("Could not resolve the file's current Drive folder");

  const destCategoryFolderId = await ensureClientCategoryFolder(client, newCategory);
  const destFolderId = await ensureFolder(destCategoryFolderId, currentMonthLabel());

  await moveFile(file.driveFileId, destFolderId, currentParent);
  await db.file.update({ where: { id: fileId }, data: { category: newCategoryKey } });
  await logActivity(db, {
    actorId: actor.id,
    action: "file.category_changed",
    entityType: "file",
    entityId: file.id,
    clientId: client.id,
    meta: { from: file.category, to: newCategoryKey },
  });
}
```

- [ ] **Step 3: Add the `clientFileMove` action**

Append at the end of `src/lib/actions.ts` (after `clientFileDelete`):
```ts

export async function clientFileMove(fileId: string, newCategoryKey: string): Promise<ActionResult> {
  return guard(() =>
    clientFiles.moveClientFile(id.parse(fileId), z.string().trim().min(1).max(64).parse(newCategoryKey)),
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 5: Manual verification — same-category no-op guard**

```bash
npx tsx -e '
import { moveClientFile } from "./src/lib/services/client-files";
moveClientFile("does-not-exist", "ASSETS").catch((e) => console.log("expected error:", e.message));
'
```
Expected: throws (either `UnauthorizedError` from the missing session, same caveat as Task 3 Step 5, or — if you are running this in a context with a session — `ValidationError: File not found`). Confirms the function is reachable and its guard clauses run before any Drive call.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/client-files.ts src/lib/actions.ts
git commit -m "$(cat <<'EOF'
feat: add moving a client-hub file between categories

Requires upload rights on both the source and destination category —
reuses the existing client.file.upload permission twice rather than
adding a new policy rule. Moved files land in the destination
category's current month subfolder. No UI wired up yet.
EOF
)"
```

---

### Task 5: Thumbnail proxy API route

**Files:**
- Create: `src/app/api/client-files/[fileId]/thumbnail/route.ts`

**Interfaces:**
- Consumes: `fetchThumbnail` (Task 1), `authorize` + `"client.file.read"` (already exists in `permissions.ts`, unused until now).
- Produces (for Task 9's UI): `GET /api/client-files/:fileId/thumbnail` → 200 image bytes, 404 if no thumbnail, 403/401 on auth failure.

- [ ] **Step 1: Write the route**

Create `src/app/api/client-files/[fileId]/thumbnail/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { fetchThumbnail } from "@/lib/drive";
import { ValidationError, errorToStatus } from "@/lib/errors";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await ctx.params;
    const file = await db.file.findUnique({ where: { id: fileId } });
    if (!file || !file.clientId) throw new ValidationError("File not found");
    await authorize("client.file.read", { client: { id: file.clientId } });

    const thumb = await fetchThumbnail(file.driveFileId);
    if (!thumb) return NextResponse.json({ error: "No thumbnail available" }, { status: 404 });

    return new NextResponse(thumb.body, {
      headers: { "Content-Type": thumb.contentType, "Cache-Control": "private, max-age=3600" },
    });
  } catch (err) {
    const status = errorToStatus(err);
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 3: Manual verification — auth guard without a session**

With the dev server running (`npm run dev`, port 3030):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/api/client-files/anything/thumbnail
```
Expected: `401` (no session cookie sent, `requireUser()` inside `authorize` throws `UnauthorizedError` before ever reaching Drive).

- [ ] **Step 4: Manual verification — real thumbnail (needs an existing file + login)**

This one does call Drive (read-only, no mutation) — safe to run without asking, but note it in your summary. Reuse the Playwright login pattern from earlier in this session (`editor1`/`password123`), grab a real `file.id` from the DB for a file already uploaded (e.g. the stray `acme-fitness-assets-editor-upload-test.png` from earlier), then:
```bash
npx tsx -e '
import { db } from "./src/lib/db";
(async () => {
  const f = await db.file.findFirst({ where: { storedName: { contains: "editor-upload-test" } } });
  console.log("file id:", f?.id);
  process.exit(0);
})();
'
```
Then, with a valid session cookie (extract via Playwright's `context.cookies()` after logging in, or check manually in a browser), confirm the route returns `200` with an image `Content-Type`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/client-files/\[fileId\]/thumbnail/route.ts
git commit -m "feat: add authenticated client-hub file thumbnail proxy route"
```

---

### Task 6: File content proxy API route

**Files:**
- Create: `src/app/api/client-files/[fileId]/content/route.ts`

**Interfaces:**
- Consumes: `fetchFileContent` (Task 1), same auth pattern as Task 5.
- Produces (for Task 7's preview modal): `GET /api/client-files/:fileId/content` → 200 full file bytes with real `Content-Type`/`Content-Length`.

- [ ] **Step 1: Write the route**

Create `src/app/api/client-files/[fileId]/content/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { fetchFileContent } from "@/lib/drive";
import { ValidationError, errorToStatus } from "@/lib/errors";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  try {
    const { fileId } = await ctx.params;
    const file = await db.file.findUnique({ where: { id: fileId } });
    if (!file || !file.clientId) throw new ValidationError("File not found");
    await authorize("client.file.read", { client: { id: file.clientId } });

    const content = await fetchFileContent(file.driveFileId);
    return new NextResponse(content.body, {
      headers: {
        "Content-Type": content.contentType,
        "Content-Length": String(content.sizeBytes),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const status = errorToStatus(err);
    return NextResponse.json({ error: (err as Error).message }, { status });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 3: Manual verification — auth guard**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3030/api/client-files/anything/content
```
Expected: `401`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/client-files/\[fileId\]/content/route.ts
git commit -m "feat: add authenticated client-hub file content proxy route"
```

---

### Task 7: File preview modal component

**Files:**
- Create: `src/components/file-preview-modal.tsx`

**Interfaces:**
- Consumes: `/api/client-files/:id/content` (Task 6), nothing else new.
- Produces (for Task 9): `FilePreviewModal({ file: { id, driveFileId, storedName, mimeType }, onClose }): JSX.Element`.

- [ ] **Step 1: Write the component**

Create `src/components/file-preview-modal.tsx`:
```tsx
"use client";

export function FilePreviewModal({
  file,
  onClose,
}: {
  file: { id: string; driveFileId: string; storedName: string; mimeType: string };
  onClose: () => void;
}) {
  const isImage = file.mimeType.startsWith("image/");
  const isVideo = file.mimeType.startsWith("video/");
  const isPdf = file.mimeType === "application/pdf";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
            {file.storedName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {isImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/client-files/${file.id}/content`}
              alt={file.storedName}
              className="mx-auto max-h-[75vh] max-w-full object-contain"
            />
          )}
          {isPdf && (
            <embed
              src={`/api/client-files/${file.id}/content`}
              type="application/pdf"
              className="h-[75vh] w-full rounded-lg"
            />
          )}
          {isVideo && (
            <iframe
              src={`https://drive.google.com/file/d/${file.driveFileId}/preview`}
              className="h-[70vh] w-full rounded-lg"
              allow="autoplay"
            />
          )}
          {!isImage && !isPdf && !isVideo && (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No in-app preview for this file type.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: `ESLint: No issues found` (the `eslint-disable-next-line` comment suppresses the one expected `@next/next/no-img-element` warning).

- [ ] **Step 4: Commit**

```bash
git add src/components/file-preview-modal.tsx
git commit -m "feat: add in-app file preview modal (image/PDF/video)"
```

---

### Task 8: Shared category drop-zone component

**Files:**
- Create: `src/components/category-drop-zone.tsx`

**Interfaces:**
- Consumes: `clientFileMove` (Task 4).
- Produces (for Tasks 10/11): `CategoryDropZone({ categoryKey: string, className?: string, children: ReactNode }): JSX.Element` — a drop target that moves a dragged file into `categoryKey` on drop.

- [ ] **Step 1: Write the component**

Create `src/components/category-drop-zone.tsx`:
```tsx
"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { clientFileMove } from "@/lib/actions";

export function CategoryDropZone({
  categoryKey,
  className,
  children,
}: {
  categoryKey: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [isOver, setIsOver] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        const raw = e.dataTransfer.getData("application/json");
        if (!raw) return;
        let dragged: { fileId: string; category: string };
        try {
          dragged = JSON.parse(raw);
        } catch {
          return;
        }
        if (!dragged.fileId || dragged.category === categoryKey) return;
        setError(null);
        startTransition(async () => {
          const res = await clientFileMove(dragged.fileId, categoryKey);
          if (!res.ok) setError(res.error ?? "Could not move file");
          else router.refresh();
        });
      }}
      className={`${className ?? ""} transition-all ${isOver ? "ring-2 ring-brand-500 ring-offset-1" : ""} ${pending ? "opacity-70" : ""}`}
    >
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found`

- [ ] **Step 3: Commit**

```bash
git add src/components/category-drop-zone.tsx
git commit -m "feat: add shared category drop-zone component for drag-and-drop file moves"
```

---

### Task 9: Wire preview/delete/move/drag into `ClientFileItem`

**Files:**
- Modify: `src/components/client-file-item.tsx` (full rewrite of the file).

**Interfaces:**
- Consumes: `clientFileDelete`, `clientFileMove` (Task 4), `FilePreviewModal` (Task 7), `/api/client-files/:id/thumbnail` (Task 5).
- Produces (for Tasks 10/11): `ClientFileItem` gains two new required props — `canModify: boolean` and `categories: { key: string; label: string }[]` — callers must be updated to pass them (done in Tasks 10/11).

- [ ] **Step 1: Rewrite the component**

Replace the full contents of `src/components/client-file-item.tsx` with:
```tsx
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
            extra={
              <div className="flex items-center gap-1">
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
                  <select
                    value=""
                    disabled={pending}
                    onChange={(e) => {
                      if (e.target.value) handleMove(e.target.value);
                    }}
                    title="Move to another category"
                    className="rounded-lg border border-slate-200/80 bg-white/50 px-1.5 py-1 text-[10px] dark:border-slate-800/80 dark:bg-slate-900/50"
                  >
                    <option value="">Move to…</option>
                    {otherCategories.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
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
            }
          />
        </div>
      </div>
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
```

- [ ] **Step 2: Typecheck (this WILL show errors — that's expected)**

Run: `npx tsc --noEmit`
Expected: errors in `src/app/client-hub/[id]/page.tsx` and `src/components/client-hub-accordion.tsx` — both currently call `<ClientFileItem file={...} canEdit={...} />` without the two new required props. This is expected and gets fixed in Tasks 10 and 11. Confirm the errors are exactly those two call sites and nothing inside `client-file-item.tsx` itself.

- [ ] **Step 3: Lint the new file specifically**

Run: `npx eslint src/components/client-file-item.tsx`
Expected: `No issues found` for this file (project-wide lint will also flag the two call sites the same way typecheck did — ignore those until Tasks 10/11).

- [ ] **Step 4: Commit**

```bash
git add src/components/client-file-item.tsx
git commit -m "$(cat <<'EOF'
feat: add thumbnail, preview, delete, and move-between-categories to ClientFileItem

Callers must now pass canModify and categories props — updated in the
next two tasks (client-hub-accordion.tsx and client-hub/[id]/page.tsx).
EOF
)"
```

---

### Task 10: Wire into the dashboard's Client Hub accordion

**Files:**
- Modify: `src/components/client-hub-accordion.tsx`

**Interfaces:**
- Consumes: `CategoryDropZone` (Task 8), updated `ClientFileItem` props (Task 9).
- Produces: nothing new for later tasks — this is a leaf wiring task.

- [ ] **Step 1: Extend the `ClientFile` interface with `mimeType`**

Change:
```ts
interface ClientFile {
  id: string;
  driveFileId: string;
  storedName: string;
  sizeBytes: bigint | number;
  category: string | null;
  description: string | null;
}
```
to:
```ts
interface ClientFile {
  id: string;
  driveFileId: string;
  storedName: string;
  sizeBytes: bigint | number;
  category: string | null;
  description: string | null;
  mimeType: string;
}
```
(The underlying Prisma query already selects the full `File` row, which includes `mimeType` — this is a type-only change, no query change needed.)

- [ ] **Step 2: Import `CategoryDropZone`**

Change:
```ts
import { AddCategoryButton } from "@/components/add-category-button";
import { ClientFileItem } from "@/components/client-file-item";
import { ClientFileUploader } from "@/components/file-drop-uploader";
import { MonthCalendar } from "@/components/month-calendar";
```
to:
```ts
import { AddCategoryButton } from "@/components/add-category-button";
import { CategoryDropZone } from "@/components/category-drop-zone";
import { ClientFileItem } from "@/components/client-file-item";
import { ClientFileUploader } from "@/components/file-drop-uploader";
import { MonthCalendar } from "@/components/month-calendar";
```

- [ ] **Step 3: Wrap the category box in `CategoryDropZone` and pass the new `ClientFileItem` props**

Change:
```tsx
                  return (
                    <div
                      key={category.key}
                      className="min-w-0 rounded-xl border border-slate-200/50 bg-white/50 p-3 dark:border-slate-800/50 dark:bg-slate-900/50 flex flex-col gap-2 h-fit"
                    >
```
to:
```tsx
                  return (
                    <CategoryDropZone
                      key={category.key}
                      categoryKey={category.key}
                      className="min-w-0 rounded-xl border border-slate-200/50 bg-white/50 p-3 dark:border-slate-800/50 dark:bg-slate-900/50 flex flex-col gap-2 h-fit"
                    >
```
And its matching closing tag — change:
```tsx
                    </div>
                  );
                })}
              </div>
```
to:
```tsx
                    </CategoryDropZone>
                  );
                })}
              </div>
```
(This is the closing tag for the category box specifically — the one right before `{fileCount === 0 && (`. Double-check by context: it's the outermost element opened as `<div key={category.key} ...>` in Step 3 above, inside the `categories.map((category) => { ... return (...); })` block.)

Then, inside that same block, change:
```tsx
                            catFiles.map((f) => (
                              <ClientFileItem
                                key={f.id}
                                file={f}
                                canEdit={canEdit}
                              />
                            ))
```
to:
```tsx
                            catFiles.map((f) => (
                              <ClientFileItem
                                key={f.id}
                                file={f}
                                canEdit={canEdit}
                                canModify={true}
                                categories={categories}
                              />
                            ))
```
(`canModify={true}` — this widget only ever renders for staff whose client list is already scoped correctly at the query level in `dashboard/page.tsx`, same reasoning already applied when the uploader itself was added here. `categories` is already in scope as a prop of `ClientCard`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found` for this file's part of the error set (the `client-hub/[id]/page.tsx` errors from Task 9 Step 2 still exist until Task 11 — confirm only that file remains in the error output).

- [ ] **Step 5: Commit**

```bash
git add src/components/client-hub-accordion.tsx
git commit -m "feat: wire drag-and-drop move + preview/delete into dashboard Client Hub widget"
```

---

### Task 11: Wire into the full client-hub page

**Files:**
- Modify: `src/app/client-hub/[id]/page.tsx`

**Interfaces:**
- Consumes: `CategoryDropZone` (Task 8), updated `ClientFileItem` props (Task 9).
- Produces: nothing new — final leaf wiring task. After this, `npx tsc --noEmit` across the whole repo is clean again.

- [ ] **Step 1: Import `CategoryDropZone`**

Change:
```ts
import { ClientFileUploader } from "@/components/file-drop-uploader";
import { MonthCalendar } from "@/components/month-calendar";
```
to:
```ts
import { CategoryDropZone } from "@/components/category-drop-zone";
import { ClientFileUploader } from "@/components/file-drop-uploader";
import { MonthCalendar } from "@/components/month-calendar";
```

- [ ] **Step 2: Wrap each category's `Section` in `CategoryDropZone` and pass the new props**

Change:
```tsx
      {categories.map((category) => (
        <Section key={category.key} title={category.label}>
          {(filesByCategory.get(category.key)?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">No files yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {filesByCategory.get(category.key)!.map((f) => (
                <ClientFileItem key={f.id} file={f} canEdit={canEdit} />
              ))}
            </ul>
          )}
          {canUploadCategory(category) && driveConfigured && !client.offboardedAt && (
            <div className="mt-3">
              <ClientFileUploader clientId={client.id} category={category.key} />
            </div>
          )}
        </Section>
      ))}
```
to:
```tsx
      {categories.map((category) => (
        <CategoryDropZone key={category.key} categoryKey={category.key}>
          <Section title={category.label}>
            {(filesByCategory.get(category.key)?.length ?? 0) === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No files yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {filesByCategory.get(category.key)!.map((f) => (
                  <ClientFileItem
                    key={f.id}
                    file={f}
                    canEdit={canEdit}
                    canModify={canUploadCategory(category)}
                    categories={categories}
                  />
                ))}
              </ul>
            )}
            {canUploadCategory(category) && driveConfigured && !client.offboardedAt && (
              <div className="mt-3">
                <ClientFileUploader clientId={client.id} category={category.key} />
              </div>
            )}
          </Section>
        </CategoryDropZone>
      ))}
```

- [ ] **Step 3: Typecheck the whole repo**

Run: `npx tsc --noEmit`
Expected: `TypeScript: No errors found` — this should now be clean everywhere, since Tasks 9-11 collectively resolved every call site.

- [ ] **Step 4: Lint the whole repo**

Run: `npm run lint`
Expected: `ESLint: No issues found`

- [ ] **Step 5: Commit**

```bash
git add src/app/client-hub/\[id\]/page.tsx
git commit -m "feat: wire drag-and-drop move + preview/delete into full client-hub page"
```

---

### Task 12: End-to-end manual verification

**Files:** none (verification only).

**Interfaces:** none — this task consumes everything built in Tasks 1-11 and produces a verified, working feature.

- [ ] **Step 1: Full typecheck + lint one more time**

```bash
npx tsc --noEmit
npm run lint
```
Expected: both clean.

- [ ] **Step 2: Ask the user before any live-Drive test**

This feature's manual verification necessarily uploads/moves/deletes real files against the real connected Drive account (`dreau@thegrowthacademy.com.au` — confirmed earlier this session, not a sandbox). Per this session's established practice, explicitly ask the user for go-ahead before running Steps 3-6, the same way it was asked before the editor-upload test and before the layout-fix visual check.

- [ ] **Step 3: Verify auto-arrange (if approved)**

Start `npm run dev:db` and `npm run dev` if not already running. Log in as `editor1`/`password123` (Playwright, same pattern as earlier this session), upload a small test file into Acme Fitness → Assets via the dashboard accordion, then confirm its Drive parent is a `YYYY-MM`-named folder inside `Assets`:
```bash
npx tsx -e '
import { db } from "./src/lib/db";
(async () => {
  const f = await db.file.findFirst({ where: { category: "ASSETS" }, orderBy: { createdAt: "desc" } });
  console.log({ id: f?.id, storedName: f?.storedName, driveFileId: f?.driveFileId });
  process.exit(0);
})();
'
```
Then confirm via the Drive API (or the Drive web UI) that this file's parent folder is named like `2026-07`, not `Assets` directly.

- [ ] **Step 4: Verify preview**

In the browser, click the new file's thumbnail — confirm the preview modal opens and renders the image inline (not a broken image icon), and that clicking the filename itself still opens Drive directly in a new tab (unchanged behavior).

- [ ] **Step 5: Verify move**

Use the "Move to…" dropdown on that file to move it to a different category (e.g. Logo). Confirm:
- The file disappears from Assets and appears in Logo in the UI after refresh.
- Its Drive parent folder actually changed (query `db.file.findUnique` for the row's `category`, and separately confirm in Drive that the file physically moved, not just the DB field).

- [ ] **Step 6: Verify delete — and clean up the leftover test file from earlier this session**

Delete the stray `acme-fitness-assets-editor-upload-test.png` file left over from an earlier test this session, via the new delete button. Confirm:
- The confirm dialog appears.
- After confirming, the file disappears from the app.
- The file shows up in Drive's Trash (not permanently gone) — search Drive's Trash for it.

This step both verifies delete and cleans up the earlier session's leftover test artifact as a side effect.

- [ ] **Step 7: Report results to the user**

Summarize what was verified, any files left in Drive (real test file created in Step 3, if not also deleted), and whether the earlier stray test file was successfully cleaned up in Step 6.

# Client hub file manager: preview, move, delete, auto-arrange

## Context

Client hub file categories (Brand Guidelines, Assets, Creatives, Unused Creatives, Logo, Brand Colors) currently only support upload and edit-description. Files pile up flat in each category's Drive folder forever, there's no way to preview a file without leaving to Drive, no way to move a file to a different category, and no way to remove one. This adds all four, scoped to the existing per-category upload permission wherever possible rather than inventing new rules.

## Auto-arrange (Drive-side only)

Each category's Drive folder gains month subfolders (`Assets/2026-07/`), resolved lazily via the existing `ensureFolder()` lookup-or-create — no new DB table, no caching of the month-folder ID. `createClientUploadSession` in `src/lib/services/client-files.ts` changes its upload destination from `ensureClientCategoryFolder(client, category)` directly to `ensureFolder(categoryFolderId, currentMonthLabel())`, where `currentMonthLabel()` is a small new helper returning `YYYY-MM` in UTC.

Existing files already uploaded stay exactly where they are (flat in the category folder) — confirmed with user, no backfill/migration job. The app's file list UI stays a flat list per category sorted newest-first — confirmed with user, no nested month UI. This is purely a Drive-organization change; nothing in the DB or UI needs to know which month subfolder a file lives in.

## Drive layer (`src/lib/drive.ts`)

Three new helpers, same shape/conventions as the existing `moveFolder`:

- `moveFile(fileId: string, addParent: string, removeParent: string): Promise<void>` — `drive.files.update({ fileId, addParents: addParent, removeParents: removeParent, supportsAllDrives: true })`.
- `trashFile(fileId: string): Promise<void>` — `drive.files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true })`. Recoverable via Drive's own Trash (~30 days), not a permanent delete.
- `fetchThumbnail(fileId: string): Promise<{ stream: Readable; contentType: string } | null>` and `fetchFileContent(fileId: string): Promise<{ stream: Readable; contentType: string; sizeBytes: number }>` — both call Drive's `files.get` with our own service/OAuth credentials (`alt: "media"` for content, the `thumbnailLink` metadata field + an authenticated fetch for the thumbnail). The browser never talks to Drive directly, so this works for every role including `CLIENT` users, who likely have no Google login at all — the existing "open in Drive" link already silently assumed staff have Drive access; this fixes that gap rather than extending it to a new feature. `fetchThumbnail` returns `null` if Drive has no thumbnail for that mimeType (caller falls back to a generic icon).

All four wrapped in the existing `withBackoff()` / concurrency-cap plumbing, same as every other `drive.ts` export.

## Service layer (`src/lib/services/client-files.ts`)

`getUploadableClient` and `completeClientUpload` already each compute `editorHasTask` (a task-count query) before calling `authorize`. `deleteClientFile` and `moveClientFile` below need the same check, which would make it four duplicated copies — so this adds one small shared helper, `resolveEditorHasTask(user, clientId)`, and switches all four call sites to it. Pure refactor of existing logic, no behavior change.

- `deleteClientFile(fileId: string): Promise<void>`
  1. Load the `File` row; `ValidationError` if missing or not a client-hub file (`clientId`/`category` null).
  2. Load the `Category` row for it.
  3. `authorize("client.file.upload", { client, category, editorHasTask })` — same rule as upload (confirmed with user: delete permission mirrors upload permission exactly, including the EDITOR-with-assigned-task scoping already added for uploads).
  4. `trashFile(file.driveFileId)` — if Drive returns 404 (already gone externally), treat as success, not an error.
  5. `db.file.delete({ where: { id: fileId } })`.
  6. `logActivity(... "file.deleted" ...)` with `{ name: file.storedName, category: file.category }` in `meta`.

- `moveClientFile(fileId: string, newCategoryKey: string): Promise<void>`
  1. Load the `File` row + its current `Category` + the target `Category` (`ValidationError` if either category key is unknown, or if `newCategoryKey` equals the current one).
  2. `authorize("client.file.upload", ...)` twice — once with the **current** category, once with the **new** category. Moving is "remove from source, add to destination"; the user needs upload rights on both ends. (This is exactly why permission was designed to reuse `client.file.upload` rather than adding a new action — no new policy rule needed.)
  3. Fetch the file's current Drive parent via `drive.files.get({ fileId, fields: "parents" })` (not cached — this is a one-off operational detail, not worth a schema column).
  4. Resolve the destination folder: `ensureClientCategoryFolder(client, newCategory)` → `ensureFolder(categoryFolderId, currentMonthLabel())`. A moved file lands in *today's* month subfolder in the new category, not the original upload month.
  5. `moveFile(file.driveFileId, addParent=destFolderId, removeParent=currentParentId)`. If this throws, abort — no DB write happens (fail atomically, no compensating rollback needed since nothing was written yet).
  6. `db.file.update({ where: { id: fileId }, data: { category: newCategoryKey } })`.
  7. `logActivity(... "file.category_changed" ...)` with `{ from: oldCategoryKey, to: newCategoryKey }`.

## API routes (new)

- `GET /api/client-files/[fileId]/thumbnail` — loads the `File` row, `authorize("client.file.read", { client })`, calls `fetchThumbnail`; 404 if null; streams `image/jpeg` (or whatever Drive returns) with a short `Cache-Control` (thumbnails are cheap to refetch, no need to persist).
- `GET /api/client-files/[fileId]/content` — same auth check, calls `fetchFileContent`, streams bytes with the file's real `mimeType`. Used for image/PDF full preview only (see below) — the route itself doesn't restrict by type, but the UI only ever calls it for those two.

Both routes 403 via the existing `errorToStatus` mapping if `authorize` throws `ForbiddenError`.

## UI

- `ClientFileItem` (`src/components/client-file-item.tsx`, shared by both the accordion and the full client-hub page):
  - Adds a small thumbnail (`<img src="/api/client-files/[id]/thumbnail">`), falling back to a generic file-type icon on load error or 404.
  - Becomes `draggable`; `onDragStart` puts `{ fileId, currentCategory }` in `dataTransfer` as JSON.
  - Gains a delete button (trash icon, `window.confirm` before calling the new `clientFileDelete` action — same confirm-then-call pattern already used by `ActionButton`).
  - Gains a "Move to ▾" `<select>` listing the other categories, calling the new `clientFileMove` action on change — the accessible/non-drag fallback for both drag-and-drop and touch devices.
  - Clicking the thumbnail or name opens a new `FilePreviewModal` instead of navigating to Drive: images render `/api/client-files/[id]/content` in an `<img>`, PDFs render it in an `<embed type="application/pdf">`, videos embed Google's own `https://drive.google.com/file/d/<driveFileId>/preview` iframe (Google's CDN streams it, we don't proxy multi-GB video through a serverless function).

- `client-hub-accordion.tsx` and `client-hub/[id]/page.tsx` — both already render one drop-target-shaped box per category (confirmed with user: drag-and-drop works on both surfaces). Each category box gets `onDragOver`/`onDrop` handlers that read the dragged file's id + current category from `dataTransfer`, call `clientFileMove`, and show a highlight state while a drag is over it — active regardless of whether that category's dropdown is currently expanded, so you can drop onto a collapsed category without first opening it.

## Actions (`src/lib/actions.ts`)

Two new thin wrappers, same `guard()` pattern as everything else in the file:
- `clientFileDelete(fileId)` → `clientFiles.deleteClientFile(id.parse(fileId))`.
- `clientFileMove(_prev, formData)` → parses `{ fileId, newCategoryKey }`, calls `clientFiles.moveClientFile(...)`.

## Error handling

- Delete: Drive 404 treated as already-deleted (proceed to remove the DB row + log), not surfaced as a failure.
- Move: any Drive API failure aborts before the DB write — no partial state.
- Permission denials on delete/move surface as an inline error near the file (reusing the existing `alert()`-on-failure pattern already in `ClientFileItem`'s description-edit handler), not a silent no-op.
- Thumbnail/content routes 404/403 cleanly; the `<img>`'s `onError` swaps in a generic icon rather than showing a broken-image glyph.

## Testing

- `npx tsc --noEmit` / `npm run lint`.
- Manual, via the existing dev server + Playwright pattern already used this session: upload a file as editor1 into Acme Fitness → Assets, confirm it lands in a `YYYY-MM` Drive subfolder (not the bare category folder). Move it to a different category, confirm the Drive parent actually changes (not just the DB row) and a staff member without upload rights on the destination category is rejected. Delete it, confirm it's gone from the app and shows up in Drive's Trash rather than being unrecoverable.
- The stray test file left over from an earlier session (`acme-fitness-assets-editor-upload-test.png`, in Acme Fitness → Assets) is used as the delete-flow's test subject — deleting it during verification also cleans up that leftover.
- Any test that uploads/moves/deletes against the real connected Drive account needs explicit user go-ahead first, per this session's established practice — the dev DB has a real `DriveConnection` (dreau@thegrowthacademy.com.au), not a sandbox.

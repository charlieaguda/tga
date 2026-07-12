# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Request flow

`src/app/**/page.tsx` are async Server Components: they call `auth()`, load data with `db` (Prisma) directly, compute `allowedTransitions()` for button visibility, and render. They hold no mutation logic.

All mutations funnel through the single file `src/lib/actions.ts` (`"use server"`): each exported function parses `FormData` with `zod`, then calls into `src/lib/services/*`, wrapped in a local `guard()` helper that catches `ValidationError`/`ConflictError`/`ForbiddenError`/`UnauthorizedError` into `{ ok, error }` and calls `revalidatePath("/", "layout")` on success. Pages wire these actions to `<ActionForm>` / `<ActionButton>` client components (see the `ActionForm` note in AGENTS.md re: manual dispatch).

Two exceptions bypass `actions.ts`: `src/app/api/tasks/[id]/uploads/route.ts` and `src/app/api/uploads/[id]/complete/route.ts` handle the Drive resumable-upload handshake directly (see README "How uploads work"), and `src/app/api/cron/*` are Bearer-`CRON_SECRET`-protected route handlers, not user-facing actions.

`src/proxy.ts` only redirects based on cookie presence for page routes (see matcher) — it is not authorization. Every action/route still calls `requireUser()`/`authorize()` from `src/lib/permissions.ts` independently.

## Roles beyond the README table

`Role` (`prisma/schema.prisma`) has six values, not the four in README's staff table: `ADMIN`, `CEO`, `MANAGER`, `EDITOR` (staff, as documented) plus `VIEWER` (internal, read-only — counted as an internal reader everywhere `isInternalReader()` is checked in `src/lib/permissions.ts`) and `CLIENT` (external, scoped to one `Client` via `User.clientId`, gated by `isOwnClient()`). A `CLIENT` user only ever sees `/client-hub/[id]` for their own client.

## Client Hub — a second, parallel upload path

`src/app/client-hub/**` and `src/lib/services/client-files.ts` are a separate file-sharing surface from the task/submission review pipeline (added in the `client_hub` migration). It doesn't follow the "all mutations go through `src/lib/services/*`" pattern any differently, but its data shape is easy to miscount:

- `File` and `UploadSession` rows are polymorphic: exactly one of `submissionId` (task deliverable), `taskId` (task attachment), or `clientId`+`category` (client-hub upload) is set per row — enforced at the service layer, not by a DB constraint (see the comment above `UploadSession` in `prisma/schema.prisma`).
- `category` is a `FileCategory` enum (`BRAND_GUIDELINES`, `ASSETS`, `CREATIVES`, `UNUSED_CREATIVES`, `LOGO`, `BRAND_COLORS`). Which categories a `CLIENT` user may upload into is a separate allowlist, `CLIENT_WRITABLE_CATEGORIES` in `src/lib/file-categories.ts` — staff-output categories (`CREATIVES`, `UNUSED_CREATIVES`) are excluded so a client can't overwrite deliverables.
- Drive folder IDs for this path are cached per `(clientId, category)` in `ClientCategoryFolder`, mirroring the same folder-ID-caching convention `Client`/`Job`/`Task`/`Submission` each use for their own row.
- Offboarded clients (`Client.offboardedAt` set) are rejected both at session-creation and again inside the upload-completion transaction — the second check closes the race where a client is offboarded mid-upload.

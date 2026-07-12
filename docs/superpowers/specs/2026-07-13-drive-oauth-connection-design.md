# Google Drive OAuth "Connect" flow (DB-stored credential)

## Context

Google Drive access today requires either `GOOGLE_SA_KEY_JSON` (a service account key, the recommended production path — created manually in GCP Console) or `GOOGLE_OAUTH_REFRESH_TOKEN` (a personal-account fallback, obtained by running `scripts/get-drive-refresh-token.ts` locally and copying the printed values into env vars). Both require editing env vars by hand and, for the OAuth fallback, running a CLI script.

This adds a third, UI-driven path: an admin visits a new `/admin/drive` page, clicks "Connect Google Drive," goes through Google's consent screen, and the resulting refresh token is captured and stored (encrypted) in the database automatically — no CLI script, no env var edit, no redeploy. This is specifically for teams without Workspace admin access to create a service account; it does not replace the service-account path, which remains the most robust option and keeps priority.

## Data model

New singleton model in `prisma/schema.prisma`:

```prisma
model DriveConnection {
  id                    String   @id @default("drive_connection")
  googleAccountEmail    String
  encryptedRefreshToken String   // AES-256-GCM ciphertext; iv + authTag packed into the same string
  connectedById         String
  connectedBy           User     @relation(fields: [connectedById], references: [id])
  createdAt             DateTime @default(now())
}
```

The fixed `id` default enforces "at most one row" without extra service-layer logic — connecting always upserts this one row, matching the codebase's existing preference (see `ClientCategoryFolder`, `Category`) for simplicity over DB-level constraints where a fixed key already does the job.

Add `"drive_connection"` to `ActivityInput.entityType` in `src/lib/activity.ts` (same pattern as adding `"category"` earlier).

New required env var: `CREDENTIALS_ENCRYPTION_KEY` — a 32-byte key, base64-encoded (matching how `GOOGLE_SA_KEY_JSON` is already base64 in this app), decoded via `Buffer.from(key, "base64")` and used with Node's built-in `crypto` (AES-256-GCM). Dedicated to this purpose rather than derived from `AUTH_SECRET`, so rotating one doesn't force rotating the other. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Credential priority (`src/lib/drive.ts`)

`getDrive()` becomes `async` and checks, in order:
1. `GOOGLE_SA_KEY_JSON` env var (unchanged — top priority, most robust).
2. `GOOGLE_OAUTH_REFRESH_TOKEN` env var (unchanged — legacy CLI-script path).
3. `DriveConnection` DB row, decrypted with `CREDENTIALS_ENCRYPTION_KEY`.

Same in-module `cached` variable as today, invalidated (`cached = null`) whenever the DB connection changes (connect/disconnect) within the same warm instance. A different warm instance keeps its cache until it naturally cycles — the same propagation delay you'd get today from an env var change requiring redeploy, arguably better since no redeploy is needed at all.

`isDriveConfigured()` becomes `async`, checking the same three sources. Callers (`client-hub/[id]/page.tsx`, `client-files.ts`, etc.) already run in async contexts, so this is a mechanical `await` addition at each call site.

The five Drive-calling functions (`ensureFolder`, `moveFolder`, `getFileInfo`, `createResumableSession`, `findFileByAppProperty`) each call `getDrive()` once at the top — each becomes `await getDrive()`.

## Routes

Both ADMIN-only (`requireUser()` + role check, matching `/admin/users`' inline convention rather than routing through `permissions.ts`'s `policy` map, since this page doesn't use that module either).

- **`GET /api/admin/drive/connect`** — builds the Google OAuth consent URL: `client_id` from `GOOGLE_OAUTH_CLIENT_ID`, `redirect_uri` = `${process.env.AUTH_URL}/api/admin/drive/callback` (reusing `AUTH_URL`, the app's existing canonical public-URL env var — already used the same way for Drive's `Origin` header in `createResumableSession`), `scope=https://www.googleapis.com/auth/drive` (matching the service account's scope), `access_type=offline`, `prompt=consent` (forces a refresh token even if this Google account already granted access before). A random `state` value is generated and stored in a short-lived signed cookie for CSRF protection, then included in the redirect. This exact redirect URI must be added to the OAuth Client's "Authorized redirect URIs" in GCP Console — a one-time setup step alongside creating the client ID itself.

- **`GET /api/admin/drive/callback`** — verifies the `state` query param against the cookie (reject on mismatch), exchanges `code` for tokens via `google.auth.OAuth2`, extracts `refresh_token` (clear error if absent — can happen if this account already has non-revoked offline access and Google skips reissuing one; message should say so), fetches the connected account's email via `oauth2.userinfo.get()`, encrypts the refresh token, upserts the singleton `DriveConnection` row, clears `getDrive()`'s cache, redirects to `/admin/drive` with a success flag. On any failure, redirects to `/admin/drive?error=<reason>` instead.

If `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` aren't set, the Connect button on `/admin/drive` is disabled with a message to set those two env vars first — a one-time GCP Console step (creating an OAuth Client ID) that can't be avoided or automated from inside the app.

## `/admin/drive` page

Server Component, same shape as `/admin/users` (`auth()` + ADMIN-only redirect). Reads the `DriveConnection` row (if any) plus whether `GOOGLE_SA_KEY_JSON`/`GOOGLE_OAUTH_REFRESH_TOKEN` are set, to explain priority when relevant.

States:
- **No env credential, no DB connection**: "Connect Google Drive" button (or disabled + hint, per above, if OAuth client env vars are missing).
- **DB connection exists**: "Connected as `email@x.com` — connected by `<name>` on `<date>`" + a "Disconnect" `ActionButton` (existing `confirm=` pattern: "Disconnect Google Drive? Uploads will stop working until reconnected or a service account is configured.").
- **SA key or OAuth env var already set**: note that it's active and taking priority — connecting here would only take effect if that env var were later removed.
- `?error=<reason>` renders a plain-language error banner at the top (same visual treatment as `ActionForm`'s `state.error`).

New service `src/lib/services/drive-connection.ts`: `getDriveConnection()`, `disconnectDrive()` — both `authorize`-gated (ADMIN), logged to `ActivityLog`.

## Testing

- `npx tsc --noEmit` / `npx eslint .`.
- The real Google consent screen can't be automated — after implementation, a human (you) clicks through Connect once; I verify the resulting `DriveConnection` row and a working upload via the existing `ClientFileUploader` flow.
- Automatable via a throwaway script (matching `scripts/verify-transitions.ts`'s style, not a new test framework): page states with/without env vars set and with/without a DB row (seeded directly via Prisma), disconnect behavior, and that `isDriveConfigured()`/`getDrive()` correctly prefer env vars over the DB row when both exist.

## Migration

Additive only (new table, no changes to existing columns) — same hand-placed-migration approach used earlier this session for `category_table` (`prisma migrate dev` refuses to run non-interactively in this environment; generate the SQL via `prisma migrate diff` or write it directly, apply via `prisma migrate deploy`).

# TGA Workflow Organizer

Internal app for The Growth Academy: social-media job workflow — briefs, deliverable uploads to Google Drive, revision rounds, approvals, posting log, dashboards.

**Stack:** Next.js (App Router) · Prisma + PostgreSQL · username + password accounts (bcrypt, DB sessions) · Google Drive (service account on a Shared Drive) · Resend (email) · Vercel (hosting + cron).

## Roles

| Role | What they do |
|---|---|
| **Admin** | Manage users/roles, everything else too |
| **CEO** | Monitor all jobs/tasks, create & assign tasks (does not approve/post) |
| **Manager** ("Staff A") | Owns client jobs: writes briefs, assigns editors, reviews, approves, posts manually, marks done |
| **Editor** ("Staff B") | Works assigned tasks: uploads deliverables, submits for review, revises |

## Task lifecycle

```
DRAFT → ASSIGNED → IN_PROGRESS → SUBMITTED → APPROVED → POSTED
                        ↑            ↓
                        └── CHANGES_REQUESTED   (revision loop, round 2, 3, …)
Any non-terminal state → CANCELLED (reason required)
```

Every transition is validated server-side (compare-and-swap — concurrent reviews get a clean conflict, never a double-approve) and written to an append-only activity log.

## Local development

```bash
npm install
npm run dev:db      # terminal 1 — embedded Postgres (no Docker needed), keep running
npm run db:migrate  # terminal 2 — apply migrations
npm run db:seed     # demo data + prints dev session tokens (no Google needed locally)
npm run dev         # http://localhost:3000
```

Sign-in locally: `admin` / `ceo` / `manager1` / `manager2` / `editor1` / `editor2`, all with password `password123` (or paste a seeded token as the `authjs.session-token` cookie — the seed prints one per user).

Checks:

```bash
npx tsx scripts/verify-transitions.ts   # state machine + CAS acceptance checks
npx tsx scripts/e2e-login.ts http://localhost:3000 admin password123  # browser login E2E
npx tsx scripts/e2e.ts http://localhost:3000 <managerToken> <editorToken>  # browser workflow E2E
npm run lint && npx tsc --noEmit
```

## Production setup (one-time)

### 1. Google Cloud + Drive

1. Create a GCP project; enable the **Google Drive API**.
2. Create a **service account** (no domain-wide delegation). Create a JSON key.
3. `base64` the JSON key → `GOOGLE_SA_KEY_JSON` env var.
4. In Google Workspace, create a **Shared Drive** (requires Business Standard or higher — Business Starter has no Shared Drives). Add the service-account email as **Content Manager**.
5. Copy the Shared Drive ID (URL segment) → `DRIVE_SHARED_DRIVE_ID`.
6. Add a staff Google Group as **Viewer** on the Shared Drive so previews (`drive.google.com/file/d/…`) open for signed-in staff.

Why a Shared Drive: service accounts have zero My Drive storage quota — uploads outside a Shared Drive fail with `storageQuotaExceeded`.

### 2. Accounts & sign-in

Username + password accounts, managed entirely in the app:

- An **Admin creates each account** in `/admin/users` — username, name, role, a starting password (share it out-of-band), and optionally an email (only used to send notification emails, not for sign-in). Users change their password under **My account**. No self-registration, no password reset by email — admins reset passwords from the Users screen.
- Passwords are bcrypt-hashed (cost 12); login failures return one generic message (no account enumeration) with a constant-time compare.
- Sessions are DB rows: deactivating a user or changing their role/password revokes their sessions instantly.
- Set `AUTH_SECRET` (`npx auth secret`) and `AUTH_URL` (your production URL — https makes the session cookie `__Secure-` + `secure`).

### 3. Vercel

1. Import the repo; set all env vars from `.env.example` (use the **pooled** Neon connection string for `DATABASE_URL`).
2. Set `CRON_SECRET` — `vercel.json` schedules `/api/cron/overdue` and `/api/cron/reconcile` daily; Vercel sends it as the Bearer token automatically.
3. Run migrations against Neon: `npx prisma migrate deploy`.
4. Create the first Admin user directly in the DB (one-time). Generate a bcrypt hash locally:
   `npx tsx -e "import b from 'bcryptjs'; console.log(b.hashSync(process.argv[1], 12))" 'your-password'`
   then:
   `INSERT INTO "User" (id, username, name, role, "passwordHash") VALUES ('admin-1', 'youradmin', 'Your Name', 'ADMIN', '<hash>');`
   Sign in and manage everyone else from `/admin/users`.

## How uploads work

Editor's browser asks the server to open a Drive **resumable upload session** (server checks role, task status, open round), then streams 16 MB chunks **directly to Google** — video bytes never touch the app server (works within Vercel limits). On completion the server verifies the file against Drive (folder, size, detected MIME type, session tag) before recording it — inside a status-guarded transaction, so an upload that finishes after approval/cancel/reassign is rejected. A nightly reconcile job expires stale sessions and re-links uploads whose browser died before confirming.

Folder layout in the Shared Drive: `Clients/{client}/{job}/{taskId}-{title}/v{round}/` — the DB stores Drive IDs; renaming folders in Drive never breaks the app.

**CORS note:** the resumable session's browser-CORS allowlist is set by the `Origin` header present on the request that *creates* the session — Drive doesn't retroactively enable it. `createResumableSession` in `src/lib/drive.ts` sends `Origin: ${AUTH_URL}` explicitly for this reason; without it, the browser's follow-up chunk PUTs fail cross-origin even though session creation itself succeeds server-side.

### Testing locally without a service account

If your org's `iam.disableServiceAccountKeyCreation` policy blocks SA key downloads, or you're testing with a personal Gmail (no Shared Drives — Workspace-only), authenticate as yourself instead:

1. Create a **plain folder** in My Drive (personal) or a real **Shared Drive** (Workspace) — either works, `DRIVE_SHARED_DRIVE_ID` just needs *a* container folder ID; the code never uses Shared-Drive-specific `driveId`/`corpora` params, only parent-scoped queries, so both work identically.
2. Cloud Console → Credentials → **OAuth client ID → Desktop app** (a different credential type than SA keys — unaffected by that org policy).
3. `npx tsx scripts/get-drive-refresh-token.ts <client-id> <client-secret>` — one-time browser consent, prints `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` to paste into `.env`.
4. `src/lib/drive.ts` prefers `GOOGLE_OAUTH_REFRESH_TOKEN` over `GOOGLE_SA_KEY_JSON` when both are unset/set — same Drive API calls either way, only the credential source differs.

## Key files

| Path | What it is |
|---|---|
| `prisma/schema.prisma` | Data model (tasks, submission rounds, files, audit log) |
| `src/auth.ts` | Auth.js config (session reader only) |
| `src/lib/services/auth-credentials.ts` | Password hashing/verification, admin reset, self change |
| `src/lib/auth-session.ts` | Mints/destroys the DB session used by username+password login |
| `src/lib/permissions.ts` | The entire permission matrix (`authorize()`, deny-by-default) |
| `src/lib/transitions.ts` | Task state machine (single source of truth) + CAS transition |
| `src/lib/services/*.ts` | All mutations: tasks, jobs, admin, uploads |
| `src/lib/drive.ts` | Drive client: backoff, folder ensure, resumable sessions |
| `src/app/api/cron/*` | Overdue notifier + upload reconciliation (Bearer `CRON_SECRET`) |
| `scripts/` | Dev DB runner, acceptance checks, browser E2E |

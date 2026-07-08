# TGA Workflow Organizer

Internal app for The Growth Academy: social-media job workflow — briefs, deliverable uploads to Google Drive, revision rounds, approvals, posting log, dashboards.

**Stack:** Next.js (App Router) · Prisma + PostgreSQL · Auth.js (Google Workspace sign-in) · Google Drive (service account on a Shared Drive) · Resend (email) · Vercel (hosting + cron).

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

Sign-in locally: paste a seeded token as the `authjs.session-token` cookie, or configure real Google OAuth in `.env` (see `.env.example`).

Checks:

```bash
npx tsx scripts/verify-transitions.ts   # state machine + CAS acceptance checks
npx tsx scripts/e2e.ts http://localhost:3000 <managerToken> <editorToken>  # browser E2E
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

### 2. Google OAuth (sign-in)

1. GCP → Credentials → OAuth client ID (Web application).
2. Authorized redirect URI: `https://<your-domain>/api/auth/callback/google`.
3. Set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` (`npx auth secret`), `AUTH_URL`, and `ALLOWED_GOOGLE_HD` (your Workspace domain).

Sign-in policy: company-domain Google accounts only (`hd` claim verified server-side), and only for users an Admin pre-created in **Users** — no auto-provisioning.

### 3. Vercel

1. Import the repo; set all env vars from `.env.example` (use the **pooled** Neon connection string for `DATABASE_URL`).
2. Set `CRON_SECRET` — `vercel.json` schedules `/api/cron/overdue` and `/api/cron/reconcile` daily; Vercel sends it as the Bearer token automatically.
3. Run migrations against Neon: `npx prisma migrate deploy`.
4. Create the first Admin user directly in the DB (one-time):
   `INSERT INTO "User" (id, email, name, role) VALUES ('admin-1', 'you@yourdomain', 'Your Name', 'ADMIN');`
   then sign in with Google and manage everyone else from `/admin/users`.

## How uploads work

Editor's browser asks the server to open a Drive **resumable upload session** (server checks role, task status, open round), then streams 16 MB chunks **directly to Google** — video bytes never touch the app server (works within Vercel limits). On completion the server verifies the file against Drive (folder, size, detected MIME type, session tag) before recording it — inside a status-guarded transaction, so an upload that finishes after approval/cancel/reassign is rejected. A nightly reconcile job expires stale sessions and re-links uploads whose browser died before confirming.

Folder layout in the Shared Drive: `Clients/{client}/{job}/{taskId}-{title}/v{round}/` — the DB stores Drive IDs; renaming folders in Drive never breaks the app.

## Key files

| Path | What it is |
|---|---|
| `prisma/schema.prisma` | Data model (tasks, submission rounds, files, audit log) |
| `src/auth.ts` | Auth.js config + domain-restricted sign-in policy |
| `src/lib/permissions.ts` | The entire permission matrix (`authorize()`, deny-by-default) |
| `src/lib/transitions.ts` | Task state machine (single source of truth) + CAS transition |
| `src/lib/services/*.ts` | All mutations: tasks, jobs, admin, uploads |
| `src/lib/drive.ts` | Drive client: backoff, folder ensure, resumable sessions |
| `src/app/api/cron/*` | Overdue notifier + upload reconciliation (Bearer `CRON_SECRET`) |
| `scripts/` | Dev DB runner, acceptance checks, browser E2E |

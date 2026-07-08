<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# TGA Workflow Organizer — agent notes

Internal Next.js (App Router) app: social-media job workflow (briefs → uploads → review rounds → approve → posted). See README.md for product/setup detail.

## Commands

- `npm run dev:db` — embedded Postgres on :5502 (keep running; data in `.pgdata/`)
- `npm run db:migrate` / `db:seed` / `db:studio`
- `npm run dev` / `build` / `lint`; typecheck: `npx tsc --noEmit`
- Acceptance checks: `npx tsx scripts/verify-transitions.ts`
- Browser login E2E: `npx tsx scripts/e2e-login.ts <url> <username> <password>` (seed default: `admin` / `password123`)
- Browser workflow E2E: `npx tsx scripts/e2e.ts <url> <managerToken> <editorToken>` (tokens printed by seed)

## Architecture rules (do not violate)

- **All mutations go through `src/lib/services/*`** — never call Prisma writes from pages/routes directly. Services do: load → `authorize()` → validate → transaction (CAS transition + activity log + notification rows) → emails after commit.
- **`src/lib/permissions.ts` is the only authorization entry point**; `src/lib/transitions.ts` is the only state-machine definition. UI buttons derive from `allowedTransitions()` but are never trusted.
- Status transitions use compare-and-swap (`updateMany WHERE id AND status`); 0 rows → `ConflictError` (409). Round numbers rely on `@@unique([taskId, round])`; P2002 → 409.
- `ActivityLog` is append-only — nothing updates or deletes rows.
- Editors are scoped at the query level (`assigneeId = me`) — never post-filter.
- All Drive access via `src/lib/drive.ts` (backoff + concurrency cap + `supportsAllDrives`). DB stores Drive IDs; never resolve Drive items by name after creation.
- Upload completion is server-verified against Drive inside a status-guarded transaction; approve/cancel/reassign invalidates pending `UploadSession`s.
- User content renders as escaped plain text (`whitespace-pre-wrap`) — never as HTML.
- Auth: username + password (bcrypt via `src/lib/services/auth-credentials.ts`) with database sessions minted by `src/lib/auth-session.ts` — NextAuth only READS sessions (`auth()`); there are no OAuth providers. `User.username` is the sign-in identifier (unique, required); `User.email` is optional and used only for notification emails. Deactivate/role-change/password-change revokes sessions. `src/proxy.ts` is optimistic redirect only — not a security boundary.
- `ActionForm` dispatches manually (preventDefault + startTransition) to stop React 19's automatic form reset from wiping fields after a failed action — don't convert forms back to plain `<form action={...}>`.

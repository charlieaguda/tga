# Client default manager/editor assignment

## Context

ADMIN currently has no way to pre-associate a client with a manager or editor — every job's manager/editor gets picked (or falls back to the creating user) independently, per job. This adds a client-level default so new jobs under that client inherit the right owner/editor automatically, without changing any existing per-job override capability.

## Data model

`prisma/schema.prisma`, `Client` model — two new optional fields:
```prisma
defaultManagerId String?
defaultManager   User?   @relation("ClientDefaultManager", fields: [defaultManagerId], references: [id])
defaultEditorId  String?
defaultEditor    User?   @relation("ClientDefaultEditor", fields: [defaultEditorId], references: [id])
```
`User` model gains the two back-relations (`Client[]`, one per relation name). Migration is additive only (two nullable FK columns).

## Permissions

New action `client.assignDefaults` in `src/lib/permissions.ts`, policy `(u) => u.role === "ADMIN"` — deliberately separate from `client.write` (which the earlier `client.write !== "CLIENT"` broadening already opened up to all staff). Setting defaults is an admin-level org-structure decision, not general client-editing.

## Service (`src/lib/services/clients.ts`)

New `setClientDefaults(clientId, { defaultManagerId: string | null; defaultEditorId: string | null })` — both fields always provided by the one caller (the "Default manager"/"Default editor" edit forms each submit independently, one field at a time, passing the other's current value through as a hidden input so a single edit never clobbers the other):
- `authorize("client.assignDefaults")`.
- If `defaultManagerId` is non-null, validate it references an active user with role `MANAGER` or `ADMIN` — same shape as `admin.reassignJobManager`'s validation.
- If `defaultEditorId` is non-null, validate active + role `EDITOR`.
- `null` clears that default (the UI's blank "— none —" option submits as an empty string, parsed to `null`).
- Updates the `Client` row, logs `client.defaults_changed` activity.

## `createJob` change (`src/lib/services/jobs.ts`)

- `managerId` resolution becomes: explicit form value (ADMIN override, unchanged) → `client.defaultManagerId` (new) → `actor.id` (existing fallback, last resort).
- After creating the job row, if `client.defaultEditorId` is set, include it directly in the `tx.job.create` data (`defaultEditorId: client.defaultEditorId`) — no need to call the separate `setJobDefaultEditor` afterward; this is purely additive to the existing create call, doesn't touch `setJobDefaultEditor` itself (which remains for post-creation changes).

## UI (`src/app/clients/page.tsx`)

Two new ADMIN-only columns, "Default manager" / "Default editor", same gating as the existing Status column (`user.role === "ADMIN"`). Each cell shows the current default's name (or "—") with a `<details>`-wrapped inline edit form (collapsed by default) — same pattern as `/admin/users`' password-reset control — containing a `<select>` of eligible users (MANAGER+ADMIN for the manager field, EDITOR for the editor field) plus a blank "— none —" option, and a Save button wired to a new `clientSetDefaults` action in `src/lib/actions.ts`.

## Out of scope (confirmed with user)

No change to dashboard/client-hub visibility or scoping — this is purely a job-creation convenience default, not a permission/visibility change.

## Testing

`npx tsc --noEmit` / `npx eslint .`. Manual: as ADMIN, set a client's default manager+editor on `/clients`, then create a job for that client leaving the manager field blank — confirm the job inherits the default manager and has `defaultEditorId` pre-set. Confirm explicit manager selection still overrides the default. Confirm non-MANAGER/EDITOR users are rejected by the picker's validation.

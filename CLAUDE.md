# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Request flow

`src/app/**/page.tsx` are async Server Components: they call `auth()`, load data with `db` (Prisma) directly, compute `allowedTransitions()` for button visibility, and render. They hold no mutation logic.

All mutations funnel through the single file `src/lib/actions.ts` (`"use server"`): each exported function parses `FormData` with `zod`, then calls into `src/lib/services/*`, wrapped in a local `guard()` helper that catches `ValidationError`/`ConflictError`/`ForbiddenError`/`UnauthorizedError` into `{ ok, error }` and calls `revalidatePath("/", "layout")` on success. Pages wire these actions to `<ActionForm>` / `<ActionButton>` client components (see the `ActionForm` note in AGENTS.md re: manual dispatch).

Two exceptions bypass `actions.ts`: `src/app/api/tasks/[id]/uploads/route.ts` and `src/app/api/uploads/[id]/complete/route.ts` handle the Drive resumable-upload handshake directly (see README "How uploads work"), and `src/app/api/cron/*` are Bearer-`CRON_SECRET`-protected route handlers, not user-facing actions.

`src/proxy.ts` only redirects based on cookie presence for page routes (see matcher) — it is not authorization. Every action/route still calls `requireUser()`/`authorize()` from `src/lib/permissions.ts` independently.

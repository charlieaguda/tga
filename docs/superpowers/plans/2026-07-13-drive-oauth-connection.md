# Google Drive OAuth Connect Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ADMIN connect Google Drive from a new `/admin/drive` page via Google's OAuth consent screen, storing the resulting refresh token encrypted in the database — no CLI script, no env var edit, no redeploy.

**Architecture:** Two new Route Handlers drive the OAuth dance (`/api/admin/drive/connect` redirects to Google, `/api/admin/drive/callback` exchanges the code and stores the result). A new `DriveConnection` singleton table holds the encrypted refresh token. `src/lib/drive.ts`'s `getDrive()`/`isDriveConfigured()` become `async` and check, in order: `GOOGLE_SA_KEY_JSON` → `GOOGLE_OAUTH_REFRESH_TOKEN` → the DB row. Everything else in `drive.ts` (backoff, folder helpers) is unchanged.

**Tech Stack:** Next.js App Router Route Handlers, Prisma, `googleapis` (already a dependency), Node's built-in `crypto` (AES-256-GCM, no new dependency).

## Global Constraints

- This project has no test framework (no jest/vitest in `package.json`) — "tests" in this plan are throwaway verification scripts run via `npx tsx`, deleted after use, matching the existing `scripts/verify-transitions.ts` convention. Do not add a test framework.
- Follow this repo's service pattern exactly: services call `authorize()` from `src/lib/permissions.ts`, wrap mutations that touch multiple tables in `db.$transaction`, log every mutation via `logActivity`.
- `npx tsc --noEmit` and `npx eslint .` must both pass after every task.
- Never commit unless explicitly asked — this plan's "Commit" steps are the exception the user already scoped in via this planning flow; if in doubt, ask before committing.
- Spec: `docs/superpowers/specs/2026-07-13-drive-oauth-connection-design.md` — read it if any task here is ambiguous, it is the source of truth for intent.

---

### Task 1: `DriveConnection` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/activity.ts`
- Create: `prisma/migrations/<timestamp>_drive_connection/migration.sql`

**Interfaces:**
- Produces: `DriveConnection` Prisma model (`id` fixed at `"drive_connection"`, `googleAccountEmail`, `encryptedRefreshToken`, `connectedById`, `createdAt`) and `User.driveConnections DriveConnection[]` back-relation. Produces `"drive_connection"` as a valid `ActivityInput.entityType`.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Add this block right after the `Category` model (both are small admin-managed singleton-ish tables, keep them near each other):

```prisma
// Stores the Drive OAuth connection made via /admin/drive, as a fallback
// when no GOOGLE_SA_KEY_JSON / GOOGLE_OAUTH_REFRESH_TOKEN env var is set —
// see src/lib/drive.ts. Fixed `id` default enforces "at most one row"
// without extra service-layer logic; connecting always upserts this row.
model DriveConnection {
  id                    String   @id @default("drive_connection")
  googleAccountEmail    String
  encryptedRefreshToken String
  connectedById         String
  connectedBy           User     @relation(fields: [connectedById], references: [id])
  createdAt             DateTime @default(now())
}
```

Add the back-relation to `model User`, in the relations block alongside the other `[]` relations (after `activities ActivityLog[]`):

```prisma
  activities        ActivityLog[]
  driveConnections  DriveConnection[]
```

- [ ] **Step 2: Add `"drive_connection"` to the activity entityType union**

In `src/lib/activity.ts`, change:

```ts
  entityType: "task" | "job" | "client" | "submission" | "user" | "file" | "comment" | "category";
```

to:

```ts
  entityType: "task" | "job" | "client" | "submission" | "user" | "file" | "comment" | "category" | "drive_connection";
```

- [ ] **Step 3: Generate the migration SQL**

`prisma migrate dev` refuses to run non-interactively in this environment (confirmed earlier this session). Instead, diff against the live dev DB directly:

```bash
cd /Users/doulos/project-systems/tga
npx prisma migrate diff --from-schema-datasource ./prisma/schema.prisma --to-schema-datamodel ./prisma/schema.prisma --script
```

Wait — that command diffs a schema against itself (no-op) if run before editing; make sure Step 1 is saved to `prisma/schema.prisma` first, then this command diffs the **live DB's actual current state** (via the datasource) against the **new target schema** in the file. Confirm the output matches the expected shape below (a `CREATE TABLE "DriveConnection"` plus an `ADD CONSTRAINT` foreign key) before proceeding — if Prisma also proposes unrelated changes, stop and investigate rather than applying blindly.

- [ ] **Step 4: Create the migration folder**

```bash
cd /Users/doulos/project-systems/tga
date -u +%Y%m%d%H%M%S
```

Use the printed timestamp to create `prisma/migrations/<timestamp>_drive_connection/migration.sql` with this content (adjust only if Step 3's diff output genuinely differs — the shape below is the expected, minimal result):

```sql
-- CreateTable
CREATE TABLE "DriveConnection" (
    "id" TEXT NOT NULL DEFAULT 'drive_connection',
    "googleAccountEmail" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriveConnection_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 5: Apply to local dev DB and regenerate the client**

```bash
cd /Users/doulos/project-systems/tga
npx prisma migrate deploy
npx prisma generate
```

Expected: "All migrations have been successfully applied." Confirm `.env`'s `DATABASE_URL` points at local Postgres (`localhost:5502`) before running this — check with:
```bash
node -e "console.log(require('fs').readFileSync('.env','utf8').match(/DATABASE_URL=\"?([^\"\n]+)\"?/)[1].split('@')[1])"
```
should print `localhost:5502/tga`. If it prints a `supabase.com` host instead, stop and ask before proceeding — do not run a new migration against production without the same care taken earlier this session (verify via `rtk proxy npx prisma migrate status` first, hand-review the SQL, then `migrate deploy`).

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors (the new model isn't referenced by any code yet, so this just confirms the schema itself is valid and the client regenerated cleanly).

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma "prisma/migrations/<timestamp>_drive_connection" src/lib/activity.ts
git commit -m "feat: add DriveConnection model for OAuth-connected Drive credentials"
```

Use the exact folder path from Step 4 (not a bare `prisma/migrations` wildcard) — the migrations directory also contains an unrelated, already-uncommitted `20260712063541_category_table/` folder from earlier work that must NOT be swept into this commit.

---

### Task 2: Encryption helper (`credential-crypto.ts`)

**Files:**
- Create: `src/lib/credential-crypto.ts`
- Test: `scripts/_verify-credential-crypto.ts` (throwaway — delete after Step 3)

**Interfaces:**
- Consumes: `process.env.CREDENTIALS_ENCRYPTION_KEY` (base64, must decode to exactly 32 bytes).
- Produces: `encryptSecret(plaintext: string): string`, `decryptSecret(ciphertext: string): string` — both used by Task 5 (`drive.ts`) and Task 4 (`drive-connection.ts` service).

- [ ] **Step 1: Write the verification script (this is the "failing test" — no implementation exists yet)**

Create `scripts/_verify-credential-crypto.ts`:

```ts
import { randomBytes } from "node:crypto";

process.env.CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { encryptSecret, decryptSecret } = await import("../src/lib/credential-crypto");

let failures = 0;
function check(name: string, ok: boolean) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}

const plaintext = "test-refresh-token-value-12345";
const ct1 = encryptSecret(plaintext);
const ct2 = encryptSecret(plaintext);

check("ciphertexts differ across calls (random IV)", ct1 !== ct2);
check("decrypt round-trips to original plaintext", decryptSecret(ct1) === plaintext);

let threw = false;
try {
  decryptSecret(ct1.slice(0, -4) + "abcd");
} catch {
  threw = true;
}
check("tampered ciphertext throws instead of returning garbage", threw);

console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to confirm it fails (module doesn't exist yet)**

```bash
cd /Users/doulos/project-systems/tga
npx tsx scripts/_verify-credential-crypto.ts
```
Expected: fails to run — `Cannot find module '../src/lib/credential-crypto'`.

- [ ] **Step 3: Implement `src/lib/credential-crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error("CREDENTIALS_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

/** Encrypts a secret for storage. Output packs iv + authTag + ciphertext into one base64 string. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/** Reverses encryptSecret. Throws if the key is wrong or the ciphertext was tampered with. */
export function decryptSecret(ciphertext: string): string {
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
```

- [ ] **Step 4: Run the verification script again**

```bash
npx tsx scripts/_verify-credential-crypto.ts
```
Expected: `ALL PASSED`.

- [ ] **Step 5: Delete the throwaway script**

```bash
rm scripts/_verify-credential-crypto.ts
```

- [ ] **Step 6: Generate and record a real encryption key for local dev**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Add the printed value to `.env` as `CREDENTIALS_ENCRYPTION_KEY=` (do not commit `.env` — it's already gitignored). This key is required for Task 5 onward.

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint .
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/credential-crypto.ts
git commit -m "feat: add AES-256-GCM helper for encrypting stored credentials"
```

---

### Task 3: `drive.manage` permission

**Files:**
- Modify: `src/lib/permissions.ts`

**Interfaces:**
- Produces: `"drive.manage"` as a valid `Action`, policy `(u) => u.role === "ADMIN"`. Consumed by Task 4's service and Task 6's routes.

- [ ] **Step 1: Add the action to the `Action` union**

In `src/lib/permissions.ts`, find:
```ts
  | "auditlog.read";
```
Change to:
```ts
  | "auditlog.read"
  | "drive.manage";
```

- [ ] **Step 2: Add the policy entry**

Find:
```ts
  "auditlog.read": (u) => u.role === "ADMIN" || u.role === "CEO",
```
Add right after it:
```ts
  "drive.manage": (u) => u.role === "ADMIN",
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/permissions.ts
git commit -m "feat: add drive.manage permission for the Drive connection admin page"
```

---

### Task 4: `drive-connection.ts` service

**Files:**
- Create: `src/lib/services/drive-connection.ts`

**Interfaces:**
- Consumes: `authorize` (`@/lib/permissions`), `logActivity` (`@/lib/activity`), `encryptSecret` (`@/lib/credential-crypto`), `invalidateDriveCache` (`@/lib/drive` — produced by Task 5; this task can be written now referencing it, Task 5 makes the import resolve).
- Produces: `getDriveConnection(): Promise<{ googleAccountEmail: string; createdAt: Date; connectedBy: { name: string } } | null>`, `connectDrive(input: { googleAccountEmail: string; refreshToken: string }): Promise<void>`, `disconnectDrive(): Promise<void>` — consumed by Task 6 (callback route) and Task 7 (page + disconnect action).

- [ ] **Step 1: Write the service**

```ts
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { encryptSecret } from "@/lib/credential-crypto";
import { invalidateDriveCache } from "@/lib/drive";

const CONNECTION_ID = "drive_connection";

export async function getDriveConnection() {
  return db.driveConnection.findUnique({
    where: { id: CONNECTION_ID },
    select: { googleAccountEmail: true, createdAt: true, connectedBy: { select: { name: true } } },
  });
}

export async function connectDrive(input: { googleAccountEmail: string; refreshToken: string }) {
  const actor = await authorize("drive.manage");
  const encryptedRefreshToken = encryptSecret(input.refreshToken);

  await db.driveConnection.upsert({
    where: { id: CONNECTION_ID },
    create: {
      id: CONNECTION_ID,
      googleAccountEmail: input.googleAccountEmail,
      encryptedRefreshToken,
      connectedById: actor.id,
    },
    update: {
      googleAccountEmail: input.googleAccountEmail,
      encryptedRefreshToken,
      connectedById: actor.id,
    },
  });

  await logActivity(db, {
    actorId: actor.id,
    action: "drive.connected",
    entityType: "drive_connection",
    entityId: CONNECTION_ID,
    meta: { googleAccountEmail: input.googleAccountEmail },
  });

  invalidateDriveCache();
}

export async function disconnectDrive() {
  const actor = await authorize("drive.manage");

  await db.driveConnection.deleteMany({ where: { id: CONNECTION_ID } });

  await logActivity(db, {
    actorId: actor.id,
    action: "drive.disconnected",
    entityType: "drive_connection",
    entityId: CONNECTION_ID,
  });

  invalidateDriveCache();
}
```

Note: this file imports `invalidateDriveCache` from `@/lib/drive`, which doesn't exist until Task 5 — `tsc` will fail until then. That's expected; Task 5 immediately follows.

- [ ] **Step 2: Commit (bundled with Task 5, since it doesn't typecheck alone)**

Skip committing here — Task 5's commit step covers both files together.

---

### Task 5: `drive.ts` — async credential resolution with DB fallback

**Files:**
- Modify: `src/lib/drive.ts`
- Modify (add `await`): `src/app/tasks/[id]/page.tsx:172,269`, `src/app/client-hub/[id]/page.tsx:111,168`, `src/lib/services/uploads.ts:88,235,300`, `src/lib/services/clients.ts:16,88`, `src/lib/services/client-files.ts:69,197`

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` is not needed here directly (only `decryptSecret`), `db` (`@/lib/db`).
- Produces: `isDriveConfigured(): Promise<boolean>` (was sync), `invalidateDriveCache(): void` (new export, consumed by Task 4). All other exports (`ensureFolder`, `moveFolder`, `getFileInfo`, `createResumableSession`, `findFileByAppProperty`, `sharedDriveRootId`, `driveViewLink`, `DriveQuotaError`) keep their existing signatures — only their internal `getDrive()` calls gain an `await`.

- [ ] **Step 1: Update imports and the credential resolution logic in `src/lib/drive.ts`**

Add to the top of the file, after the existing `import { google, type drive_v3 } from "googleapis";`:

```ts
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/credential-crypto";
```

Replace the entire `getDrive` function (and the `cached` line above it) with:

```ts
let cached: { drive: drive_v3.Drive; auth: DriveAuthClient } | null = null;

/** Called by drive-connection.ts after connect/disconnect so the next Drive call picks up the change. */
export function invalidateDriveCache(): void {
  cached = null;
}

async function resolveOAuthRefreshToken(): Promise<string | null> {
  if (process.env.GOOGLE_OAUTH_REFRESH_TOKEN) return process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const conn = await db.driveConnection.findUnique({ where: { id: "drive_connection" } });
  return conn ? decryptSecret(conn.encryptedRefreshToken) : null;
}

async function getDrive() {
  if (cached) return cached;

  const raw = process.env.GOOGLE_SA_KEY_JSON;
  let auth: DriveAuthClient;
  if (raw) {
    const key = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });
  } else {
    const refreshToken = await resolveOAuthRefreshToken();
    if (!refreshToken)
      throw new Error(
        "Google Drive is not configured — set GOOGLE_SA_KEY_JSON, GOOGLE_OAUTH_REFRESH_TOKEN, or connect via /admin/drive",
      );
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret)
      throw new Error("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured");
    const client = new google.auth.OAuth2(clientId, clientSecret);
    client.setCredentials({ refresh_token: refreshToken });
    auth = client;
  }
  cached = { drive: google.drive({ version: "v3", auth }), auth };
  return cached;
}
```

Note the priority change: the old code checked `GOOGLE_OAUTH_REFRESH_TOKEN` *before* `GOOGLE_SA_KEY_JSON` (an `if (refreshToken) {...} else {SA key}` chain, despite the file's header comment implying SA was primary). This plan flips that so `GOOGLE_SA_KEY_JSON` is checked first, per the explicit design decision that the service account always wins when present — this only changes behavior for the edge case where both env vars are set simultaneously, which the header comment already described as SA-primary/OAuth-fallback.

- [ ] **Step 2: Update the 5 internal call sites in the same file to `await`**

Each of these currently reads `const { drive } = getDrive();` or `const { auth } = getDrive();` — add `await`:

```bash
cd /Users/doulos/project-systems/tga
grep -n "= getDrive();" src/lib/drive.ts
```
Expected output (line numbers may shift slightly after Step 1's edit, use this to locate them): four `const { drive } = getDrive();` occurrences (in `ensureFolder`, `moveFolder`, `getFileInfo`, `findFileByAppProperty`) and one `const { auth } = getDrive();` (in `createResumableSession`). Change each to `const { drive } = await getDrive();` / `const { auth } = await getDrive();` respectively. All five enclosing functions are already `async` — no other signature changes needed.

- [ ] **Step 3: Make `isDriveConfigured` async**

Replace:
```ts
export function isDriveConfigured(): boolean {
  const hasCredential = !!process.env.GOOGLE_SA_KEY_JSON || !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  return hasCredential && !!process.env.DRIVE_SHARED_DRIVE_ID;
}
```
with:
```ts
export async function isDriveConfigured(): Promise<boolean> {
  if (!process.env.DRIVE_SHARED_DRIVE_ID) return false;
  if (process.env.GOOGLE_SA_KEY_JSON || process.env.GOOGLE_OAUTH_REFRESH_TOKEN) return true;
  const conn = await db.driveConnection.findUnique({ where: { id: "drive_connection" }, select: { id: true } });
  return conn !== null;
}
```

- [ ] **Step 4: Update every external caller of `isDriveConfigured()` to `await` it**

Each call site below is already inside an `async` function (Server Component page or async service function) — confirmed during planning. Add `await` in front of each call, no other changes:

- `src/app/tasks/[id]/page.tsx:172`: `{canAttach && (await isDriveConfigured()) && (`
- `src/app/tasks/[id]/page.tsx:269`: `{(await isDriveConfigured()) ? (`
- `src/app/client-hub/[id]/page.tsx:111`: `{!(await isDriveConfigured()) && (`
- `src/app/client-hub/[id]/page.tsx:168`: `{canUploadCategory(category) && (await isDriveConfigured()) && !client.offboardedAt && (`
- `src/lib/services/uploads.ts:88`: `if (!(await isDriveConfigured()))`
- `src/lib/services/uploads.ts:235`: `if (await isDriveConfigured()) {`
- `src/lib/services/uploads.ts:300`: `if (!(await isDriveConfigured()))`
- `src/lib/services/clients.ts:16`: `const driveFolderId = (await isDriveConfigured())`
- `src/lib/services/clients.ts:88`: `if ((await isDriveConfigured()) && client.driveFolderId) {`
- `src/lib/services/client-files.ts:69`: `if (!(await isDriveConfigured()))`
- `src/lib/services/client-files.ts:197`: `if (!(await isDriveConfigured())) return { relinked: 0 };`

Since these two page files call `isDriveConfigured()` twice each (once per JSX branch), calling it twice per render is fine (cheap DB lookup, not in a hot loop) — do not try to hoist/cache it across the two call sites, that's an unnecessary refactor outside this task's scope.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors. This is the real verification for this task — a missing `await` on a `Promise<boolean>` used in a JSX truthiness check (`{await isDriveConfigured() && ...}` written without the parens shown above) is a common mistake here; TypeScript will flag a `Promise<boolean>` being used where a plain value renders, or ESLint's `no-misused-promises`-style rule may catch it — if either complains, check operator precedence: `await` binds tighter than `&&`/`!`, so `!(await x())` and `(await x()) && y` need the explicit parens shown above; `!await x()` alone is also valid but less readable — prefer the parenthesized form for consistency with the list above.

- [ ] **Step 6: Lint**

```bash
npx eslint .
```

- [ ] **Step 7: Manual smoke check — confirm existing Drive-gated pages still render**

```bash
lsof -i :3030 -sTCP:LISTEN 2>/dev/null || echo "not running"
```
If a dev server is running, hit `/tasks/<some-id>` and `/client-hub/<some-id>` as `admin`/`password123` locally and confirm the "Google Drive isn't configured yet" messaging still appears correctly (local dev almost certainly has no Drive credentials configured, so this exercises the "not configured" branch of every changed call site).

- [ ] **Step 8: Commit (both Task 4 and Task 5's files together, since Task 4 didn't typecheck alone)**

```bash
git add src/lib/drive.ts src/lib/services/drive-connection.ts src/app/tasks/\[id\]/page.tsx src/app/client-hub/\[id\]/page.tsx src/lib/services/uploads.ts src/lib/services/clients.ts src/lib/services/client-files.ts
git commit -m "feat: async Drive credential resolution with DB-stored OAuth fallback"
```

---

### Task 6: OAuth routes

**Files:**
- Create: `src/app/api/admin/drive/connect/route.ts`
- Create: `src/app/api/admin/drive/callback/route.ts`

**Interfaces:**
- Consumes: `authorize` (`@/lib/permissions`), `connectDrive` (`@/lib/services/drive-connection`, from Task 4).
- Produces: `GET /api/admin/drive/connect` (redirects to Google), `GET /api/admin/drive/callback` (redirects to `/admin/drive?connected=1` or `/admin/drive?error=<reason>`) — consumed by Task 7's page (the "Connect" link points at the first route).

- [ ] **Step 1: Write the connect route**

Create `src/app/api/admin/drive/connect/route.ts`:

```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { randomBytes } from "node:crypto";
import { authorize } from "@/lib/permissions";

export async function GET() {
  const base = process.env.AUTH_URL ?? "http://localhost:3030";

  try {
    // Fail fast here (rather than only inside connectDrive() at the callback)
    // so a non-admin never gets redirected to Google's consent screen at all.
    await authorize("drive.manage");
  } catch {
    return NextResponse.redirect(new URL("/admin/drive?error=unauthorized", base));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/admin/drive?error=oauth_client_not_configured", base));
  }

  const redirectUri = `${base}/api/admin/drive/callback`;
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const state = randomBytes(16).toString("hex");

  const cookieStore = await cookies();
  cookieStore.set("drive_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/userinfo.email"],
    state,
  });

  return NextResponse.redirect(url);
}
```

- [ ] **Step 2: Write the callback route**

Create `src/app/api/admin/drive/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { authorize } from "@/lib/permissions";
import { connectDrive } from "@/lib/services/drive-connection";

export async function GET(req: NextRequest) {
  const base = process.env.AUTH_URL ?? "http://localhost:3030";

  try {
    await authorize("drive.manage");
  } catch {
    return NextResponse.redirect(new URL("/admin/drive?error=unauthorized", base));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("drive_oauth_state")?.value;
  cookieStore.delete("drive_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/admin/drive?error=invalid_state", base));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/admin/drive?error=oauth_client_not_configured", base));
  }

  try {
    const redirectUri = `${base}/api/admin/drive/callback`;
    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(new URL("/admin/drive?error=no_refresh_token", base));
    }
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    if (!data.email) {
      return NextResponse.redirect(new URL("/admin/drive?error=no_email", base));
    }

    await connectDrive({ googleAccountEmail: data.email, refreshToken: tokens.refresh_token });

    return NextResponse.redirect(new URL("/admin/drive?connected=1", base));
  } catch (err) {
    console.error("[drive-callback] failed:", err);
    return NextResponse.redirect(new URL("/admin/drive?error=callback_failed", base));
  }
}
```

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint .
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/drive
git commit -m "feat: add Google Drive OAuth connect/callback routes"
```

---

### Task 7: `/admin/drive` page + disconnect action + nav link

**Files:**
- Create: `src/app/admin/drive/page.tsx`
- Modify: `src/lib/actions.ts`
- Modify: `src/app/layout.tsx:81` (add nav link right after the existing Users link)

**Interfaces:**
- Consumes: `getDriveConnection`, `disconnectDrive` (`@/lib/services/drive-connection`, Task 4), `ActionButton` (`@/components/action-button`), `PageHeader`/`Section` (`@/components/ui`), `fmtDate` (`@/lib/format`).
- Produces: `driveDisconnect(): Promise<ActionResult>` in `actions.ts`, consumed by this page's `ActionButton`.

- [ ] **Step 1: Add the disconnect action to `src/lib/actions.ts`**

Add the import alongside the other service imports near the top:
```ts
import * as driveConnection from "@/lib/services/drive-connection";
```

Add the action function (place it near `categoryCreate`, both are small admin-config actions):
```ts
export async function driveDisconnect(): Promise<ActionResult> {
  return guard(() => driveConnection.disconnectDrive());
}
```

- [ ] **Step 2: Write `src/app/admin/drive/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDriveConnection } from "@/lib/services/drive-connection";
import { driveDisconnect } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { PageHeader, Section } from "@/components/ui";
import { fmtDate } from "@/lib/format";

const ERROR_MESSAGES: Record<string, string> = {
  oauth_client_not_configured: "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first, then reload this page.",
  invalid_state: "Login attempt expired or was tampered with — try connecting again.",
  no_refresh_token:
    "Google didn't return a refresh token. If this account already granted access before, revoke it at myaccount.google.com/permissions and try again.",
  no_email: "Couldn't read the connected account's email.",
  callback_failed: "Something went wrong connecting to Google Drive.",
  unauthorized: "You don't have permission to manage this.",
};

export default async function DriveSettingsPage(props: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role !== "ADMIN") redirect("/dashboard");

  const { error, connected } = await props.searchParams;
  const hasEnvCredential = !!process.env.GOOGLE_SA_KEY_JSON || !!process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const hasOAuthClient = !!process.env.GOOGLE_OAUTH_CLIENT_ID && !!process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const connection = await getDriveConnection();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Google Drive" />

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          {ERROR_MESSAGES[error] ?? "Something went wrong."}
        </div>
      )}
      {connected && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400">
          Google Drive connected.
        </div>
      )}

      <Section title="Connection">
        {hasEnvCredential && (
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            A service account or OAuth env var is already configured and takes priority over any connection below.
          </p>
        )}
        {connection ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              Connected as <span className="font-medium">{connection.googleAccountEmail}</span> — connected by{" "}
              {connection.connectedBy.name} on {fmtDate(connection.createdAt)}.
            </p>
            <ActionButton
              action={driveDisconnect}
              label="Disconnect"
              variant="danger"
              confirm="Disconnect Google Drive? Uploads will stop working until reconnected or a service account is configured."
            />
          </div>
        ) : hasOAuthClient ? (
          <a
            href="/api/admin/drive/connect"
            className="inline-flex items-center rounded-xl bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-brand-500/10"
          >
            Connect Google Drive
          </a>
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first (GCP Console → Credentials → OAuth
            Client ID), then reload this page.
          </p>
        )}
      </Section>
    </div>
  );
}
```

- [ ] **Step 3: Add the nav link in `src/app/layout.tsx`**

Find:
```tsx
              {user.role === "ADMIN" && <NavLink href="/admin/users">Users</NavLink>}
```
Add right after it:
```tsx
              {user.role === "ADMIN" && <NavLink href="/admin/drive">Drive</NavLink>}
```

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint .
```

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/drive src/lib/actions.ts src/app/layout.tsx
git commit -m "feat: add /admin/drive page for connecting/disconnecting Drive"
```

---

### Task 8: Verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm `CREDENTIALS_ENCRYPTION_KEY` is set locally**

Check `.env` has the value generated in Task 2 Step 6. If running against local dev Postgres, restart the dev server so it picks up the new env var (Next.js only reads `.env` at process start).

- [ ] **Step 2: Manual click-through (cannot be automated — no way to script Google's real consent screen)**

With `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` set in `.env` (one-time GCP Console step, per the spec — a personal Gmail test account works fine here since this doesn't need a Shared Drive to verify the connect flow itself, only real Drive folder operations would):
1. Log in as `admin`/`password123`, visit `/admin/drive`.
2. Click "Connect Google Drive", complete Google's consent screen.
3. Confirm redirect back to `/admin/drive?connected=1` showing "Connected as `<email>`".

- [ ] **Step 3: Verify the stored row**

```bash
cd /Users/doulos/project-systems/tga
node -e "
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
db.driveConnection.findUnique({ where: { id: 'drive_connection' } }).then(row => {
  console.log('email:', row?.googleAccountEmail);
  console.log('encrypted token looks like ciphertext (not the raw token):', row?.encryptedRefreshToken.length > 40);
  return db.\$disconnect();
});
"
```
Expected: prints the connected email and confirms the stored value is base64 ciphertext, not a plaintext Google refresh token (which would start with `1//`).

- [ ] **Step 4: Verify disconnect**

Click "Disconnect" on `/admin/drive`, confirm the page reverts to showing the "Connect Google Drive" button, and re-run Step 3's query — expect `row` to be `null`.

- [ ] **Step 5: Verify credential priority (env var still wins over DB row)**

With a DB connection present (repeat Step 2 if you disconnected in Step 4), temporarily set `GOOGLE_OAUTH_REFRESH_TOKEN` in `.env` to any non-empty placeholder string and restart the dev server. Confirm `/admin/drive` now shows the "already configured via env var" note instead of the connect/disconnect controls being the active source — this is a page-copy check only (the page doesn't attempt real Drive calls with a placeholder token). Remove the placeholder afterward.

- [ ] **Step 6: Full regression pass**

```bash
npx tsc --noEmit
npx eslint .
```
Both must be clean before considering this plan complete.

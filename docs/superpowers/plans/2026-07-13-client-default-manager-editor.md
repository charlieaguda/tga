# Client Default Manager/Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let ADMIN set a default manager/editor per client, so new jobs for that client inherit them automatically.

**Architecture:** Two new nullable FK columns on `Client`. A new ADMIN-only service function sets them. `createJob` consults `client.defaultManagerId` as a fallback (ADMIN only — see Global Constraints) and copies `client.defaultEditorId` onto the new job directly. Two new admin-only columns on `/clients` with collapsed inline edit forms.

**Tech Stack:** Prisma, Next.js Server Actions — no new libraries.

## Global Constraints

- No test framework in this repo — verification is `npx tsc --noEmit` / `npx eslint .` plus manual browser checks, following `scripts/verify-transitions.ts`'s established "throwaway script or manual click-through" convention, not a new test suite.
- **Refinement caught during planning, binding on Task 3**: the client's `defaultManagerId` fallback applies **only when the actor is ADMIN**. A MANAGER creating a job always still becomes its owner (existing "managers own what they create" behavior, `jobs.ts:17` comment) — MANAGER's job-creation form has no manager field to override with anyway (admin-only field, `jobs/page.tsx:118`), so falling through to a client's default for a MANAGER would silently reassign a job away from the person who just created it. Only ADMIN's blank-dropdown case should inherit the client default.
- Migration is additive only (two nullable FK columns) — same pattern as every migration this session, hand-placed via `prisma migrate diff` (not `migrate dev`, which refuses non-interactively in this environment).
- Never commit unless explicitly asked — this plan's "Commit" steps are pre-authorized as part of executing this approved plan.

---

### Task 1: Schema + migration + permission

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_client_defaults/migration.sql`
- Modify: `src/lib/permissions.ts`

**Interfaces:**
- Produces: `Client.defaultManagerId`/`defaultEditorId` (nullable), `User.defaultManagerForClients`/`defaultEditorForClients` back-relations, `Client.defaultManager`/`defaultEditor` relations. Produces `"client.assignDefaults"` as a valid `Action`, policy `(u) => u.role === "ADMIN"`.

- [ ] **Step 1: Add fields to `model Client` in `prisma/schema.prisma`**

Current (`prisma/schema.prisma:126-141`):
```prisma
model Client {
  id            String     @id @default(cuid())
  name          String     @unique
  notes         String?
  isActive      Boolean    @default(true)
  driveFolderId String?
  notionUrl     String? // Notion page embedded full-screen on the client hub page
  offboardedAt  DateTime? // null = normal; set when the client is archived/offboarded
  createdAt     DateTime   @default(now())

  jobs            Job[]
  users           User[]
  files           File[]
  uploadSessions  UploadSession[]
  categoryFolders ClientCategoryFolder[]
}
```

Replace with:
```prisma
model Client {
  id               String     @id @default(cuid())
  name             String     @unique
  notes            String?
  isActive         Boolean    @default(true)
  driveFolderId    String?
  notionUrl        String? // Notion page embedded full-screen on the client hub page
  offboardedAt     DateTime? // null = normal; set when the client is archived/offboarded
  defaultManagerId String? // pre-fills new jobs' manager for ADMIN-created jobs only — see jobs.ts createJob
  defaultManager   User?      @relation("ClientDefaultManager", fields: [defaultManagerId], references: [id])
  defaultEditorId  String? // copied onto new jobs' defaultEditorId at creation
  defaultEditor    User?      @relation("ClientDefaultEditor", fields: [defaultEditorId], references: [id])
  createdAt        DateTime   @default(now())

  jobs            Job[]
  users           User[]
  files           File[]
  uploadSessions  UploadSession[]
  categoryFolders ClientCategoryFolder[]
}
```

- [ ] **Step 2: Add back-relations to `model User`**

Find (`prisma/schema.prisma:86-87`):
```prisma
  activities        ActivityLog[]
  driveConnections  DriveConnection[]
```
Add right after:
```prisma
  activities        ActivityLog[]
  driveConnections  DriveConnection[]
  defaultManagerForClients Client[] @relation("ClientDefaultManager")
  defaultEditorForClients  Client[] @relation("ClientDefaultEditor")
```

- [ ] **Step 3: Generate migration SQL**

```bash
cd /Users/doulos/project-systems/tga
npx prisma migrate diff --from-schema-datasource ./prisma/schema.prisma --to-schema-datamodel ./prisma/schema.prisma --script
```
Confirm the output is exactly two `ALTER TABLE "Client" ADD COLUMN` statements plus two `ADD CONSTRAINT ... FOREIGN KEY` statements referencing `User(id)` — no drops, no unrelated changes. If anything else appears, stop and investigate before proceeding.

- [ ] **Step 4: Create the migration folder**

```bash
date -u +%Y%m%d%H%M%S
```
Create `prisma/migrations/<timestamp>_client_defaults/migration.sql` with Step 3's exact output (adjust column/constraint names only if Prisma's actual generated names differ from the guess below — trust the Step 3 output over this):
```sql
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "defaultManagerId" TEXT,
ADD COLUMN     "defaultEditorId" TEXT;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_defaultManagerId_fkey" FOREIGN KEY ("defaultManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_defaultEditorId_fkey" FOREIGN KEY ("defaultEditorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 5: Apply and regenerate client**

```bash
cd /Users/doulos/project-systems/tga
node -e "console.log(require('fs').readFileSync('.env','utf8').match(/DATABASE_URL=\"?([^\"\n]+)\"?/)[1].split('@')[1])"
```
Must print `localhost:5502/tga` — if it prints a `supabase.com` host, stop and ask before proceeding.
```bash
npx prisma migrate deploy
npx prisma generate
```
Expected: "All migrations have been successfully applied."

- [ ] **Step 6: Add the permission**

In `src/lib/permissions.ts`, find:
```ts
  | "auditlog.read"
  | "drive.manage";
```
Change to:
```ts
  | "auditlog.read"
  | "drive.manage"
  | "client.assignDefaults";
```
Find:
```ts
  "drive.manage": (u) => u.role === "ADMIN",
```
Add right after:
```ts
  "client.assignDefaults": (u) => u.role === "ADMIN",
```

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/permissions.ts
git commit -m "feat: add Client default manager/editor fields + permission"
```

---

### Task 2: `setClientDefaults` service function

**Files:**
- Modify: `src/lib/services/clients.ts`

**Interfaces:**
- Consumes: `authorize("client.assignDefaults")` from Task 1.
- Produces: `setClientDefaults(clientId: string, input: { defaultManagerId: string | null; defaultEditorId: string | null }): Promise<void>` — consumed by Task 4's action.

- [ ] **Step 1: Add the function to `src/lib/services/clients.ts`**

Add after `setClientNotionUrl` (currently ends at line 75):
```ts
export async function setClientDefaults(
  clientId: string,
  input: { defaultManagerId: string | null; defaultEditorId: string | null },
) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const actor = await authorize("client.assignDefaults");

  if (input.defaultManagerId) {
    const manager = await db.user.findUnique({ where: { id: input.defaultManagerId } });
    if (!manager?.isActive || (manager.role !== "MANAGER" && manager.role !== "ADMIN"))
      throw new ValidationError("Default manager must be an active manager");
  }
  if (input.defaultEditorId) {
    const editor = await db.user.findUnique({ where: { id: input.defaultEditorId } });
    if (!editor?.isActive || editor.role !== "EDITOR")
      throw new ValidationError("Default editor must be an active editor");
  }

  await db.$transaction(async (tx) => {
    await tx.client.update({
      where: { id: clientId },
      data: {
        defaultManagerId: input.defaultManagerId,
        defaultEditorId: input.defaultEditorId,
      },
    });
    await logActivity(tx, {
      actorId: actor.id,
      action: "client.defaults_changed",
      entityType: "client",
      entityId: clientId,
      clientId,
      meta: { defaultManagerId: input.defaultManagerId, defaultEditorId: input.defaultEditorId },
    });
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/services/clients.ts
git commit -m "feat: add setClientDefaults service function"
```

---

### Task 3: `createJob` inherits client defaults

**Files:**
- Modify: `src/lib/services/jobs.ts:7-45`

**Interfaces:**
- Consumes: `client.defaultManagerId`/`defaultEditorId` from Task 1's schema (already loaded via the existing `db.client.findUnique` call in this function — no new query needed).
- Produces: no new exports — same `createJob` signature, extended behavior only.

- [ ] **Step 1: Update the manager-resolution and job-creation logic**

Current (`src/lib/services/jobs.ts:7-45`):
```ts
export async function createJob(input: {
  clientId: string;
  title: string;
  description?: string;
  managerId?: string; // Admin may create on behalf of a manager
}) {
  const actor = await authorize("job.create");
  const client = await db.client.findUnique({ where: { id: input.clientId } });
  if (!client?.isActive) throw new ValidationError("Client not found or inactive");

  // Managers own the jobs they create; Admin may pick the owning manager.
  let managerId = actor.id;
  if (input.managerId && input.managerId !== actor.id) {
    if (actor.role !== "ADMIN") throw new ValidationError("Only Admin can assign another manager");
    const manager = await db.user.findUnique({ where: { id: input.managerId } });
    if (!manager?.isActive || (manager.role !== "MANAGER" && manager.role !== "ADMIN"))
      throw new ValidationError("Owner must be an active manager");
    managerId = manager.id;
  }

  return db.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        clientId: client.id,
        managerId,
        title: input.title.trim(),
        description: input.description?.trim(),
      },
    });
    await logActivity(tx, {
      actorId: actor.id,
      action: "job.created",
      entityType: "job",
      entityId: job.id,
      jobId: job.id,
    });
    return job;
  });
}
```

Replace with:
```ts
export async function createJob(input: {
  clientId: string;
  title: string;
  description?: string;
  managerId?: string; // Admin may create on behalf of a manager
}) {
  const actor = await authorize("job.create");
  const client = await db.client.findUnique({ where: { id: input.clientId } });
  if (!client?.isActive) throw new ValidationError("Client not found or inactive");

  // Managers own the jobs they create; Admin may pick the owning manager,
  // or leave it blank to inherit the client's default manager (if set).
  let managerId = actor.id;
  if (input.managerId && input.managerId !== actor.id) {
    if (actor.role !== "ADMIN") throw new ValidationError("Only Admin can assign another manager");
    const manager = await db.user.findUnique({ where: { id: input.managerId } });
    if (!manager?.isActive || (manager.role !== "MANAGER" && manager.role !== "ADMIN"))
      throw new ValidationError("Owner must be an active manager");
    managerId = manager.id;
  } else if (!input.managerId && actor.role === "ADMIN" && client.defaultManagerId) {
    managerId = client.defaultManagerId;
  }

  return db.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: {
        clientId: client.id,
        managerId,
        title: input.title.trim(),
        description: input.description?.trim(),
        defaultEditorId: client.defaultEditorId ?? undefined,
      },
    });
    await logActivity(tx, {
      actorId: actor.id,
      action: "job.created",
      entityType: "job",
      entityId: job.id,
      jobId: job.id,
    });
    return job;
  });
}
```

Note exactly what changed: the `else if` branch (client-default fallback, ADMIN-only per Global Constraints), and `defaultEditorId: client.defaultEditorId ?? undefined` added to the `tx.job.create` data. Nothing else in this function changes.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/services/jobs.ts
git commit -m "feat: createJob inherits client's default manager/editor"
```

---

### Task 4: UI — `/clients` page + action

**Files:**
- Modify: `src/lib/actions.ts`
- Modify: `src/app/clients/page.tsx`

**Interfaces:**
- Consumes: `setClientDefaults` from Task 2.
- Produces: `clientSetDefaults(_prev: ActionResult, formData: FormData): Promise<ActionResult>` in `actions.ts`, consumed by this task's own page edit.

- [ ] **Step 1: Add the action to `src/lib/actions.ts`**

Add near `clientSetNotionUrl` (both are small client-config actions):
```ts
export async function clientSetDefaults(_prev: ActionResult, formData: FormData) {
  const parsed = z
    .object({
      clientId: id,
      defaultManagerId: z.string().trim().optional(),
      defaultEditorId: z.string().trim().optional(),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  return guard(() =>
    clients.setClientDefaults(parsed.data.clientId, {
      defaultManagerId: parsed.data.defaultManagerId || null,
      defaultEditorId: parsed.data.defaultEditorId || null,
    }),
  );
}
```
(`clients` is already imported at the top of `actions.ts` as `import * as clients from "@/lib/services/clients";` — no new import needed. `id` and `z` are already imported/defined in this file too.)

- [ ] **Step 2: Update `src/app/clients/page.tsx`**

Current imports (`src/app/clients/page.tsx:1-7`):
```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { clientCreate, clientSetActive } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Section, EmptyState } from "@/components/ui";
```
Change to:
```tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { clientCreate, clientSetActive, clientSetDefaults } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Section, EmptyState } from "@/components/ui";
```

Current client query (`src/app/clients/page.tsx:18-21`):
```tsx
  const clients = await db.client.findMany({
    include: { jobs: { where: { status: { not: "ARCHIVED" } }, select: { id: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
```
Change to (also fetch the two default-user names, and the pool of eligible managers/editors for the pickers):
```tsx
  const [clients, managers, editors] = await Promise.all([
    db.client.findMany({
      include: {
        jobs: { where: { status: { not: "ARCHIVED" } }, select: { id: true } },
        defaultManager: { select: { name: true } },
        defaultEditor: { select: { name: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.user.findMany({
      where: { isActive: true, role: { in: ["MANAGER", "ADMIN"] } },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isActive: true, role: "EDITOR" },
      orderBy: { name: "asc" },
    }),
  ]);
```

Current table header (`src/app/clients/page.tsx:33-39`):
```tsx
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Active jobs</th>
                  <th className="py-2 pr-4 font-medium">Notes</th>
                  {user.role === "ADMIN" && <th className="py-2 font-medium">Status</th>}
                </tr>
              </thead>
```
Change to:
```tsx
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">Active jobs</th>
                  <th className="py-2 pr-4 font-medium">Notes</th>
                  {user.role === "ADMIN" && <th className="py-2 pr-4 font-medium">Default manager</th>}
                  {user.role === "ADMIN" && <th className="py-2 pr-4 font-medium">Default editor</th>}
                  {user.role === "ADMIN" && <th className="py-2 font-medium">Status</th>}
                </tr>
              </thead>
```

Current row (`src/app/clients/page.tsx:42-77`), insert two new `<td>`s between the Notes `<td>` (ending `</td>` before line 55's `{user.role === "ADMIN" && (`) and the Status `<td>`. Find:
```tsx
                    <td className="py-2.5 pr-4 whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                      {c.notes ?? "—"}
                    </td>
                    {user.role === "ADMIN" && (
                      <td className="py-2.5">
```
Change to:
```tsx
                    <td className="py-2.5 pr-4 whitespace-pre-wrap text-slate-600 dark:text-slate-300">
                      {c.notes ?? "—"}
                    </td>
                    {user.role === "ADMIN" && (
                      <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">
                        <details>
                          <summary className="cursor-pointer select-none">
                            {c.defaultManager?.name ?? "—"}
                          </summary>
                          <ActionForm
                            action={clientSetDefaults}
                            submitLabel="Save"
                            className="mt-2 flex flex-col gap-2"
                            resetOnSuccess={false}
                          >
                            <input type="hidden" name="clientId" value={c.id} />
                            <input type="hidden" name="defaultEditorId" value={c.defaultEditorId ?? ""} />
                            <select name="defaultManagerId" defaultValue={c.defaultManagerId ?? ""} className={inputCls}>
                              <option value="">— none —</option>
                              {managers.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          </ActionForm>
                        </details>
                      </td>
                    )}
                    {user.role === "ADMIN" && (
                      <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">
                        <details>
                          <summary className="cursor-pointer select-none">
                            {c.defaultEditor?.name ?? "—"}
                          </summary>
                          <ActionForm
                            action={clientSetDefaults}
                            submitLabel="Save"
                            className="mt-2 flex flex-col gap-2"
                            resetOnSuccess={false}
                          >
                            <input type="hidden" name="clientId" value={c.id} />
                            <input type="hidden" name="defaultManagerId" value={c.defaultManagerId ?? ""} />
                            <select name="defaultEditorId" defaultValue={c.defaultEditorId ?? ""} className={inputCls}>
                              <option value="">— none —</option>
                              {editors.map((e) => (
                                <option key={e.id} value={e.id}>{e.name}</option>
                              ))}
                            </select>
                          </ActionForm>
                        </details>
                      </td>
                    )}
                    {user.role === "ADMIN" && (
                      <td className="py-2.5">
```
(The rest of that `<td>` — the Deactivate/Reactivate `ActionButton` block and its closing tags — is unchanged; only the opening `{user.role === "ADMIN" && (<td className="py-2.5">` line is being matched/kept as the anchor for what follows it, which stays as-is.)

`inputCls` is already defined at the top of this file (`src/app/clients/page.tsx:9-10`) — reused as-is, no new style constant needed.

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint .
```
Expected: no errors.

- [ ] **Step 4: Manual verification**

```bash
lsof -i :3030 -sTCP:LISTEN 2>/dev/null || echo "not running"
```
If a local dev server is running (seeded DB, `admin`/`password123`): visit `/clients`, expand "Default manager" for a client, pick one, Save — confirm it displays afterward. Then go to `/jobs`, create a job for that client leaving the manager dropdown on its default/blank state — confirm the created job's manager (visible on `/jobs/[id]`) matches the client's default. Then explicitly pick a different manager in the dropdown when creating another job for the same client — confirm the explicit pick wins over the default.

- [ ] **Step 5: Commit**

```bash
git add src/lib/actions.ts src/app/clients/page.tsx
git commit -m "feat: add default manager/editor pickers to /clients page"
```

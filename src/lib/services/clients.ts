import { db } from "@/lib/db";
import { authorize, requireUser } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { ensureFolder, isDriveConfigured, moveFolder, sharedDriveRootId } from "@/lib/drive";
import { slugify } from "@/lib/slug";
import { listCategories } from "@/lib/services/categories";
import { ensureClientCategoryFolder } from "@/lib/services/client-files";

export async function createClient(input: {
  name: string;
  notes?: string;
  defaultManagerId?: string;
  defaultEditorId?: string;
}) {
  const actor = await authorize("client.write");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Client name is required");

  let defaultManagerId: string | undefined;
  if (actor.role === "MANAGER") {
    defaultManagerId = actor.id;
  } else if (actor.role === "ADMIN" && input.defaultManagerId) {
    const manager = await db.user.findUnique({ where: { id: input.defaultManagerId } });
    if (!manager?.isActive || (manager.role !== "MANAGER" && manager.role !== "ADMIN"))
      throw new ValidationError("Default manager must be an active manager");
    defaultManagerId = input.defaultManagerId;
  }

  let defaultEditorId: string | undefined;
  if (input.defaultEditorId) {
    const editor = await db.user.findUnique({ where: { id: input.defaultEditorId } });
    if (!editor?.isActive || editor.role !== "EDITOR")
      throw new ValidationError("Default editor must be an active editor");
    defaultEditorId = input.defaultEditorId;
  }

  // Eagerly create the Drive folder so a hub is Drive-connected from the
  // start, rather than waiting for the first client-hub upload to create it
  // (see ensureClientCategoryFolder in client-files.ts for the lazy path).
  const driveFolderId = (await isDriveConfigured())
    ? await ensureFolder(await ensureFolder(sharedDriveRootId(), "Clients"), slugify(name))
    : null;

  const client = await db.$transaction(async (tx) => {
    const created = await tx.client.create({
      data: {
        name,
        notes: input.notes?.trim(),
        driveFolderId,
        defaultManagerId,
        defaultEditorId,
      },
    });
    await logActivity(tx, {
      actorId: actor.id,
      action: "client.created",
      entityType: "client",
      entityId: created.id,
      clientId: created.id,
    });
    return created;
  });

  // Eagerly create every category's Drive subfolder too, so a fresh client's
  // Drive folder mirrors the app's category list from the start instead of
  // filling in one-by-one as each category gets its first upload. Failures
  // are logged and swallowed rather than failing client creation — the lazy
  // path in ensureClientCategoryFolder backfills any missing folder on that
  // category's first upload.
  if (driveFolderId) {
    const categories = await listCategories();
    await Promise.all(
      categories.map((category) =>
        ensureClientCategoryFolder(client, category).catch((err) =>
          console.error("[client] failed to eagerly create category folder:", category.key, err),
        ),
      ),
    );
  }

  return client;
}

async function assertNoOpenJobs(clientId: string) {
  const activeJobs = await db.job.count({ where: { clientId, status: { not: "ARCHIVED" } } });
  if (activeJobs > 0)
    throw new ValidationError(
      `Client has ${activeJobs} job(s) that aren't archived — archive them first`,
    );
}

export async function setClientActive(clientId: string, isActive: boolean) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const actor = await authorize("client.deactivate");

  if (!isActive) await assertNoOpenJobs(clientId);

  await db.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { isActive } });
    await logActivity(tx, {
      actorId: actor.id,
      action: isActive ? "client.reactivated" : "client.deactivated",
      entityType: "client",
      entityId: clientId,
      clientId,
    });
  });
}

export async function setClientNotionUrl(clientId: string, notionUrl: string | null) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const actor = await authorize("client.write");

  await db.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { notionUrl } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "client.notion_url_changed",
      entityType: "client",
      entityId: clientId,
      clientId,
    });
  });
}

export async function setClientDefaultManager(clientId: string, defaultManagerId: string | null) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const actor = await authorize("client.assignDefaults");

  if (defaultManagerId) {
    const manager = await db.user.findUnique({ where: { id: defaultManagerId } });
    if (!manager?.isActive || (manager.role !== "MANAGER" && manager.role !== "ADMIN"))
      throw new ValidationError("Default manager must be an active manager");
  }

  await db.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { defaultManagerId } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "client.default_manager_changed",
      entityType: "client",
      entityId: clientId,
      clientId,
      meta: { from: client.defaultManagerId, to: defaultManagerId },
    });
  });
}

/** ADMIN can set any client's default editor; a MANAGER only for a client they already default-manage. */
export async function setClientDefaultEditor(clientId: string, defaultEditorId: string | null) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const actor = await requireUser();
  if (actor.role !== "ADMIN" && !(actor.role === "MANAGER" && client.defaultManagerId === actor.id))
    throw new ForbiddenError();

  if (defaultEditorId) {
    const editor = await db.user.findUnique({ where: { id: defaultEditorId } });
    if (!editor?.isActive || editor.role !== "EDITOR")
      throw new ValidationError("Default editor must be an active editor");
  }

  await db.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { defaultEditorId } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "client.default_editor_changed",
      entityType: "client",
      entityId: clientId,
      clientId,
      meta: { from: client.defaultEditorId, to: defaultEditorId },
    });
  });
}

/**
 * Offboard a client: move its Drive folder under a global "Archive" parent
 * (skipped gracefully if Drive isn't configured or the client never got a
 * folder), then flip isActive/offboardedAt via CAS so a double-click is safe.
 */
export async function offboardClient(clientId: string) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const actor = await authorize("client.deactivate");
  await assertNoOpenJobs(clientId);

  if ((await isDriveConfigured()) && client.driveFolderId) {
    const clientsRoot = await ensureFolder(sharedDriveRootId(), "Clients");
    const archiveRoot = await ensureFolder(sharedDriveRootId(), "Archive");
    await moveFolder(client.driveFolderId, clientsRoot, archiveRoot);
  }

  await db.$transaction(async (tx) => {
    const { count } = await tx.client.updateMany({
      where: { id: clientId, offboardedAt: null },
      data: { isActive: false, offboardedAt: new Date() },
    });
    if (count === 0) throw new ConflictError();
    await logActivity(tx, {
      actorId: actor.id,
      action: "client.offboarded",
      entityType: "client",
      entityId: clientId,
      clientId,
    });
  });
}

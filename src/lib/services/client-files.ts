import type { Category, Client, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize, requireUser } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  createResumableSession,
  ensureFolder,
  findFileByAppProperty,
  isDriveConfigured,
  sharedDriveRootId,
} from "@/lib/drive";
import { sanitizeFileName, slugify } from "@/lib/slug";
import { assertValidUploadDeclaration, verifyDriveUpload } from "@/lib/upload-policy";

/**
 * Idempotent lookup-or-create of the Drive folder for a (client, category)
 * pair, caching the ID in ClientCategoryFolder — mirrors how Client/Job/
 * Task/Submission each cache their own folder ID on their own row.
 */
export async function ensureClientCategoryFolder(client: Client, category: Category): Promise<string> {
  const existing = await db.clientCategoryFolder.findUnique({
    where: { clientId_category: { clientId: client.id, category: category.key } },
  });
  if (existing) return existing.driveFolderId;

  const clientsRoot = await ensureFolder(sharedDriveRootId(), "Clients");
  let clientFolder = client.driveFolderId;
  if (!clientFolder) {
    clientFolder = await ensureFolder(clientsRoot, slugify(client.name));
    await db.client.update({ where: { id: client.id }, data: { driveFolderId: clientFolder } });
  }
  const categoryFolder = await ensureFolder(clientFolder, category.label);

  try {
    await db.clientCategoryFolder.create({
      data: { clientId: client.id, category: category.key, driveFolderId: categoryFolder },
    });
  } catch (err) {
    // Race: another request created the same (client, category) row first —
    // re-fetch rather than error, same idiom as other @@unique races.
    if ((err as { code?: string }).code === "P2002") {
      const row = await db.clientCategoryFolder.findUniqueOrThrow({
        where: { clientId_category: { clientId: client.id, category: category.key } },
      });
      return row.driveFolderId;
    }
    throw err;
  }
  return categoryFolder;
}

async function getUploadableClient(clientId: string, categoryKey: string) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const category = await db.category.findUnique({ where: { key: categoryKey } });
  if (!category) throw new ValidationError("Unknown file category");

  const user = await requireUser();
  const editorHasTask =
    user.role === "EDITOR"
      ? (await db.task.count({ where: { assigneeId: user.id, job: { clientId } } })) > 0
      : undefined;

  const actor = await authorize("client.file.upload", { client, category, editorHasTask });
  if (!client.isActive || client.offboardedAt)
    throw new ConflictError("This client is offboarded — uploads are disabled");
  return { client, category, actor };
}

export async function createClientUploadSession(
  clientId: string,
  categoryKey: string,
  input: { fileName: string; sizeBytes: number; mimeType: string },
) {
  if (!(await isDriveConfigured()))
    throw new ValidationError("Google Drive is not configured yet — ask an admin");
  assertValidUploadDeclaration(input);

  const { client, category, actor } = await getUploadableClient(clientId, categoryKey);
  const folderId = await ensureClientCategoryFolder(client, category);

  const original = sanitizeFileName(input.fileName);
  const storedName = `${slugify(client.name, 30)}-${slugify(category.label, 40)}-${original}`;

  const session = await db.uploadSession.create({
    data: {
      clientId: client.id,
      category: category.key,
      editorId: actor.id,
      fileName: original,
      declaredSize: BigInt(input.sizeBytes),
      declaredMime: input.mimeType,
    },
  });

  // The Drive session URI is returned to the uploader only — never logged/persisted.
  const sessionUri = await createResumableSession({
    folderId,
    fileName: storedName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    appProperties: { uploadSessionId: session.id, clientId: client.id },
  });

  return { uploadId: session.id, sessionUri, storedName };
}

const sessionInclude = { client: true } satisfies Prisma.UploadSessionInclude;

type SessionWithMaybeClient = Prisma.UploadSessionGetPayload<{ include: typeof sessionInclude }>;

type SessionWithClient = SessionWithMaybeClient & {
  client: NonNullable<SessionWithMaybeClient["client"]>;
  category: NonNullable<SessionWithMaybeClient["category"]>;
};

function hasClientCategory(session: SessionWithMaybeClient): session is SessionWithClient {
  return session.client !== null && session.category !== null;
}

export async function completeClientUpload(uploadId: string, driveFileId: string) {
  const session = await db.uploadSession.findUnique({
    where: { id: uploadId },
    include: sessionInclude,
  });
  if (!session) throw new ValidationError("Upload session not found");
  if (!hasClientCategory(session))
    throw new ValidationError("This upload session is not a client-hub upload");
  const category = await db.category.findUnique({ where: { key: session.category } });
  if (!category) throw new ValidationError("Unknown file category");
  const user = await requireUser();
  const editorHasTask =
    user.role === "EDITOR"
      ? (await db.task.count({ where: { assigneeId: user.id, job: { clientId: session.client.id } } })) > 0
      : undefined;
  const actor = await authorize("client.file.upload", {
    client: session.client,
    category,
    editorHasTask,
  });
  if (session.editorId !== actor.id && actor.role !== "ADMIN")
    throw new ForbiddenError("This upload belongs to another user");
  if (session.status !== "PENDING") throw new ConflictError("Upload session is no longer active");

  const file = await verifyAndRecordClientUpload(session, driveFileId, actor);
  return { fileId: file.id };
}

async function verifyAndRecordClientUpload(
  session: SessionWithClient,
  driveFileId: string,
  actor: { id: string; role: string },
) {
  const folder = await db.clientCategoryFolder.findUnique({
    where: { clientId_category: { clientId: session.client.id, category: session.category } },
  });

  const info = await verifyDriveUpload({
    driveFileId,
    uploadSessionId: session.id,
    expectedFolderId: folder?.driveFolderId ?? null,
    declaredSize: session.declaredSize,
  });

  // Status-guarded transaction: the client may have been offboarded while
  // the browser was still uploading.
  const file = await db.$transaction(async (tx) => {
    const claimed = await tx.uploadSession.updateMany({
      where: { id: session.id, status: "PENDING" },
      data: { status: "COMPLETED", driveFileId },
    });
    if (claimed.count === 0) throw new ConflictError("Upload session is no longer active");

    const current = await tx.client.findUniqueOrThrow({
      where: { id: session.client.id },
      select: { isActive: true, offboardedAt: true },
    });
    if (!current.isActive || current.offboardedAt !== null)
      throw new ConflictError("This client was offboarded while the file was uploading");

    const created = await tx.file.create({
      data: {
        clientId: session.client.id,
        category: session.category,
        driveFileId,
        fileName: session.fileName,
        storedName: info.name,
        mimeType: info.mimeType,
        sizeBytes: BigInt(info.size),
        uploadedById: session.editorId,
      },
    });
    await logActivity(tx, {
      actorId: actor.id,
      action: "file.uploaded",
      entityType: "file",
      entityId: created.id,
      clientId: session.client.id,
      meta: { category: session.category, name: info.name },
    });
    return created;
  });

  return file;
}

/** Nightly reconciliation for client-hub uploads (cron-only). */
export async function reconcileClientUploads(): Promise<{ relinked: number }> {
  if (!(await isDriveConfigured())) return { relinked: 0 };

  const pending = await db.uploadSession.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: new Date(Date.now() - 3_600_000) },
      clientId: { not: null },
    },
    include: sessionInclude,
    take: 100,
  });

  let relinked = 0;
  for (const session of pending) {
    if (!hasClientCategory(session)) continue;
    try {
      const driveFileId = await findFileByAppProperty("uploadSessionId", session.id);
      if (!driveFileId) continue;
      await verifyAndRecordClientUpload(session, driveFileId, {
        id: session.editorId,
        role: "EDITOR",
      });
      relinked++;
    } catch {
      // Guarded failure (client offboarded, etc.) — leave for expiry.
    }
  }
  return { relinked };
}

export async function updateClientFileDescription(fileId: string, description: string) {
  const actor = await requireUser();
  const file = await db.file.findUnique({
    where: { id: fileId },
  });
  if (!file) throw new ValidationError("File not found");

  if (actor.role !== "ADMIN" && actor.role !== "MANAGER" && actor.role !== "EDITOR") {
    throw new ForbiddenError("You are not authorized to update file descriptions");
  }

  if (actor.role === "EDITOR") {
    if (!file.clientId) {
      throw new ForbiddenError("You are not authorized to update this file description");
    }
    const hasTask = await db.task.count({
      where: { assigneeId: actor.id, job: { clientId: file.clientId } },
    });
    if (hasTask === 0) {
      throw new ForbiddenError("You are not authorized to update file descriptions for this client");
    }
  }

  const updated = await db.file.update({
    where: { id: fileId },
    data: { description },
  });

  await logActivity(db, {
    actorId: actor.id,
    action: "file.description.updated",
    entityType: "file",
    entityId: fileId,
    clientId: file.clientId ?? undefined,
    meta: { name: file.storedName, description },
  });

  return updated;
}

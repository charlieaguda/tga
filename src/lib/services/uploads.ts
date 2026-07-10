import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import {
  createResumableSession,
  ensureFolder,
  findFileByAppProperty,
  getFileInfo,
  isDriveConfigured,
  sharedDriveRootId,
} from "@/lib/drive";
import { sanitizeFileName, slugify } from "@/lib/slug";
import { assertValidUploadDeclaration, verifyDriveUpload } from "@/lib/upload-policy";

const uploadInclude = {
  job: { include: { client: true } },
  assignee: true,
} satisfies Prisma.TaskInclude;

export type TaskForUpload = Prisma.TaskGetPayload<{ include: typeof uploadInclude }>;

/**
 * Ensure /Clients/{client}/{job}/{taskId}-{slug}/ exists, persisting each
 * level's Drive folder ID (DB is the source of truth; names are cosmetic).
 * Shared by the deliverable path (which adds a v{round} subfolder on top)
 * and the task-attachment path (which uploads directly here).
 */
async function ensureTaskFolder(task: TaskForUpload): Promise<string> {
  if (task.driveFolderId) return task.driveFolderId;

  const clientsRoot = await ensureFolder(sharedDriveRootId(), "Clients");

  let clientFolder = task.job.client.driveFolderId;
  if (!clientFolder) {
    clientFolder = await ensureFolder(clientsRoot, slugify(task.job.client.name));
    await db.client.update({
      where: { id: task.job.client.id },
      data: { driveFolderId: clientFolder },
    });
  }

  let jobFolder = task.job.driveFolderId;
  if (!jobFolder) {
    jobFolder = await ensureFolder(clientFolder, slugify(task.job.title));
    await db.job.update({ where: { id: task.job.id }, data: { driveFolderId: jobFolder } });
  }

  const taskFolder = await ensureFolder(jobFolder, `${task.id}-${slugify(task.title)}`);
  await db.task.update({ where: { id: task.id }, data: { driveFolderId: taskFolder } });
  return taskFolder;
}

async function ensureSubmissionFolder(
  task: TaskForUpload,
  submission: { id: string; round: number; driveFolderId: string | null },
): Promise<string> {
  if (submission.driveFolderId) return submission.driveFolderId;

  const taskFolder = await ensureTaskFolder(task);
  const versionFolder = await ensureFolder(taskFolder, `v${submission.round}`);
  await db.submission.update({
    where: { id: submission.id },
    data: { driveFolderId: versionFolder },
  });
  return versionFolder;
}

async function getUploadableSubmission(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId }, include: uploadInclude });
  if (!task) throw new ValidationError("Task not found");
  const actor = await authorize("submission.create", task);
  if (task.status !== "IN_PROGRESS")
    throw new ConflictError("Uploads are only allowed while the task is in progress");
  const submission = await db.submission.findFirst({
    where: { taskId, submittedAt: null },
    orderBy: { round: "desc" },
  });
  if (!submission) throw new ConflictError("No open round — start the task or revision first");
  return { task, actor, submission };
}

export async function createUploadSession(
  taskId: string,
  input: { fileName: string; sizeBytes: number; mimeType: string },
) {
  if (!isDriveConfigured())
    throw new ValidationError("Google Drive is not configured yet — ask an admin");
  assertValidUploadDeclaration(input);

  const { task, actor, submission } = await getUploadableSubmission(taskId);
  const folderId = await ensureSubmissionFolder(task, submission);

  const original = sanitizeFileName(input.fileName);
  const storedName = `${slugify(task.job.client.name, 30)}-${slugify(task.title, 40)}-v${submission.round}-${original}`;

  const session = await db.uploadSession.create({
    data: {
      submissionId: submission.id,
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
    appProperties: { uploadSessionId: session.id, submissionId: submission.id },
  });

  return { uploadId: session.id, sessionUri, storedName };
}

const sessionInclude = {
  submission: { include: { task: { include: uploadInclude } } },
} satisfies Prisma.UploadSessionInclude;

type SessionWithTask = Prisma.UploadSessionGetPayload<{ include: typeof sessionInclude }>;

// This function (and verifyAndRecordUpload below) only ever handles the
// deliverable-upload path — submissionId is required here even though it's
// optional on the model (task-attachment and client-hub uploads use their
// own completion functions, see uploads.ts task-attachment additions and
// client-files.ts).
type SessionWithSubmission = SessionWithTask & {
  submission: NonNullable<SessionWithTask["submission"]>;
};

function hasSubmission(session: SessionWithTask): session is SessionWithSubmission {
  return session.submission !== null;
}

export async function completeUpload(uploadId: string, driveFileId: string) {
  const session = await db.uploadSession.findUnique({
    where: { id: uploadId },
    include: sessionInclude,
  });
  if (!session) throw new ValidationError("Upload session not found");
  if (!hasSubmission(session)) throw new ValidationError("This upload session is not a deliverable upload");
  const task = session.submission.task;
  const actor = await authorize("submission.create", task);
  if (session.editorId !== actor.id && actor.role !== "ADMIN")
    throw new ForbiddenError("This upload belongs to another user");
  if (session.status !== "PENDING") throw new ConflictError("Upload session is no longer active");

  const file = await verifyAndRecordUpload(session, driveFileId, actor);
  return { fileId: file.id };
}

/**
 * Verify the Drive file against the session's declaration, then record it in a
 * status-guarded transaction. Shared by the editor's complete call and the
 * nightly reconciliation re-link (which attributes the action to the editor).
 */
async function verifyAndRecordUpload(
  session: SessionWithSubmission,
  driveFileId: string,
  actor: { id: string; role: string },
) {
  const task = session.submission.task;

  const info = await verifyDriveUpload({
    driveFileId,
    uploadSessionId: session.id,
    expectedFolderId: session.submission.driveFolderId,
    declaredSize: session.declaredSize,
  });

  // Status-guarded transaction: the task may have been approved/cancelled/
  // reassigned while the browser was still uploading.
  const file = await db.$transaction(async (tx) => {
    const claimed = await tx.uploadSession.updateMany({
      where: { id: session.id, status: "PENDING" },
      data: { status: "COMPLETED", driveFileId },
    });
    if (claimed.count === 0) throw new ConflictError("Upload session is no longer active");

    const current = await tx.task.findUniqueOrThrow({
      where: { id: task.id },
      select: { status: true, assigneeId: true },
    });
    const open = await tx.submission.findUniqueOrThrow({
      where: { id: session.submission.id },
      select: { submittedAt: true },
    });
    if (current.status !== "IN_PROGRESS" || open.submittedAt !== null)
      throw new ConflictError("The round closed while the file was uploading");
    if (current.assigneeId !== session.editorId && actor.role !== "ADMIN")
      throw new ConflictError("The task was reassigned while the file was uploading");

    const created = await tx.file.create({
      data: {
        submissionId: session.submission.id,
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
      jobId: task.jobId,
      taskId: task.id,
      meta: { round: session.submission.round, name: info.name },
    });
    return created;
  });

  return file;
}

const SESSION_TTL_MS = 7 * 86_400_000; // Drive resumable session URIs live ~1 week

/** Nightly reconciliation (cron-only; caller must authenticate the request). */
export async function reconcileUploads() {
  // 1. Expire stale pending sessions (Google discards uncommitted bytes itself).
  const expired = await db.uploadSession.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - SESSION_TTL_MS) } },
    data: { status: "EXPIRED" },
  });

  let relinked = 0;
  let missing = 0;
  if (isDriveConfigured()) {
    // 2. Re-link finished uploads whose browser died before calling complete.
    //    Same status guards as the normal path — never inject into closed rounds.
    //    Scoped to deliverable (submissionId-set) sessions; task-attachment and
    //    client-hub uploads have their own completion/reconcile functions.
    const pending = await db.uploadSession.findMany({
      where: {
        status: "PENDING",
        createdAt: { lt: new Date(Date.now() - 3_600_000) },
        submissionId: { not: null },
      },
      include: sessionInclude,
      take: 100,
    });
    for (const session of pending) {
      if (!hasSubmission(session)) continue;
      try {
        const driveFileId = await findFileByAppProperty("uploadSessionId", session.id);
        if (!driveFileId) continue;
        await verifyAndRecordUpload(session, driveFileId, {
          id: session.editorId,
          role: "EDITOR",
        });
        relinked++;
      } catch {
        // Guarded failure (round closed, task reassigned…) — leave for expiry.
      }
    }

    // 3. Flag DB rows whose Drive file vanished (deleted/moved by hand).
    const files = await db.file.findMany({
      where: { driveStatus: "ok" },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, driveFileId: true },
    });
    for (const f of files) {
      const info = await getFileInfo(f.driveFileId);
      if (!info) {
        await db.file.update({ where: { id: f.id }, data: { driveStatus: "missing" } });
        missing++;
      }
    }
  }

  return { expired: expired.count, relinked, missing };
}

// ---------- Task attachments (reference/PEG images, brief material) ----------
// Uploaded by whoever writes the brief (manager/CEO/admin), not the assigned
// editor, and not gated by round state — only by the task not being closed.

async function getAttachableTask(taskId: string) {
  const task = await db.task.findUnique({ where: { id: taskId }, include: uploadInclude });
  if (!task) throw new ValidationError("Task not found");
  const actor = await authorize("task.write", task);
  if (task.status === "POSTED" || task.status === "CANCELLED")
    throw new ConflictError("This task is closed — attachments can no longer be added");
  return { task, actor };
}

export async function createTaskAttachmentUploadSession(
  taskId: string,
  input: { fileName: string; sizeBytes: number; mimeType: string },
) {
  if (!isDriveConfigured())
    throw new ValidationError("Google Drive is not configured yet — ask an admin");
  assertValidUploadDeclaration(input);

  const { task, actor } = await getAttachableTask(taskId);
  const folderId = await ensureTaskFolder(task);

  const original = sanitizeFileName(input.fileName);
  const storedName = `${slugify(task.job.client.name, 30)}-${slugify(task.title, 40)}-ref-${original}`;

  const session = await db.uploadSession.create({
    data: {
      taskId: task.id,
      editorId: actor.id,
      fileName: original,
      declaredSize: BigInt(input.sizeBytes),
      declaredMime: input.mimeType,
    },
  });

  const sessionUri = await createResumableSession({
    folderId,
    fileName: storedName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    appProperties: { uploadSessionId: session.id, taskId: task.id },
  });

  return { uploadId: session.id, sessionUri, storedName };
}

const taskSessionInclude = {
  task: { include: uploadInclude },
} satisfies Prisma.UploadSessionInclude;

type SessionWithMaybeTaskAttachment = Prisma.UploadSessionGetPayload<{
  include: typeof taskSessionInclude;
}>;

type SessionWithTaskAttachment = SessionWithMaybeTaskAttachment & {
  task: NonNullable<SessionWithMaybeTaskAttachment["task"]>;
};

function hasTaskAttachment(
  session: SessionWithMaybeTaskAttachment,
): session is SessionWithTaskAttachment {
  return session.task !== null;
}

export async function completeTaskAttachmentUpload(uploadId: string, driveFileId: string) {
  const session = await db.uploadSession.findUnique({
    where: { id: uploadId },
    include: taskSessionInclude,
  });
  if (!session) throw new ValidationError("Upload session not found");
  if (!hasTaskAttachment(session))
    throw new ValidationError("This upload session is not a task attachment");
  const actor = await authorize("task.write", session.task);
  if (session.editorId !== actor.id && actor.role !== "ADMIN")
    throw new ForbiddenError("This upload belongs to another user");
  if (session.status !== "PENDING") throw new ConflictError("Upload session is no longer active");

  const info = await verifyDriveUpload({
    driveFileId,
    uploadSessionId: session.id,
    expectedFolderId: session.task.driveFolderId,
    declaredSize: session.declaredSize,
  });

  const file = await db.$transaction(async (tx) => {
    const claimed = await tx.uploadSession.updateMany({
      where: { id: session.id, status: "PENDING" },
      data: { status: "COMPLETED", driveFileId },
    });
    if (claimed.count === 0) throw new ConflictError("Upload session is no longer active");

    const current = await tx.task.findUniqueOrThrow({
      where: { id: session.task.id },
      select: { status: true },
    });
    if (current.status === "POSTED" || current.status === "CANCELLED")
      throw new ConflictError("This task closed while the file was uploading");

    const created = await tx.file.create({
      data: {
        taskId: session.task.id,
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
      jobId: session.task.jobId,
      taskId: session.task.id,
      meta: { attachment: true, name: info.name },
    });
    return created;
  });

  return { fileId: file.id };
}

import { Prisma, ReviewDecision, TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { transitionTask } from "@/lib/transitions";
import { logActivity } from "@/lib/activity";
import { createNotifications, type NotificationInput } from "@/lib/notifications";
import { sendEmails } from "@/lib/email";
import { ConflictError, ValidationError } from "@/lib/errors";

const taskWithJob = { job: true, assignee: true } satisfies Prisma.TaskInclude;
type TaskWithJob = Prisma.TaskGetPayload<{ include: typeof taskWithJob }>;

async function getTaskOrThrow(taskId: string): Promise<TaskWithJob> {
  const task = await db.task.findUnique({ where: { id: taskId }, include: taskWithJob });
  if (!task) throw new ValidationError("Task not found");
  return task;
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Wrap a transaction so a concurrent round-number collision surfaces as 409. */
async function runTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await db.$transaction(fn);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError();
    throw err;
  }
}

async function invalidatePendingUploads(tx: Prisma.TransactionClient, taskId: string) {
  await tx.uploadSession.updateMany({
    where: { submission: { taskId }, status: "PENDING" },
    data: { status: "INVALIDATED" },
  });
}

// ---------- Create / edit ----------

export async function createTask(input: {
  jobId: string;
  title: string;
  brief?: string;
  referenceLink?: string;
  dueAt?: Date;
  assigneeId?: string;
}) {
  const job = await db.job.findUnique({ where: { id: input.jobId } });
  if (!job) throw new ValidationError("Job not found");
  if (job.status !== "ACTIVE") throw new ValidationError("Job is not active — new tasks are blocked");
  const actor = await authorize("task.create", job);

  let assignee: { id: string; email: string | null } | null = null;
  if (input.assigneeId) {
    const candidate = await db.user.findUnique({ where: { id: input.assigneeId } });
    if (!candidate?.isActive || candidate.role !== "EDITOR")
      throw new ValidationError("Assignee must be an active editor");
    if (!input.brief?.trim())
      throw new ValidationError("Write a brief before assigning an editor at creation");
    assignee = candidate;
  }

  const { task, emails } = await runTx(async (tx) => {
    const created = await tx.task.create({
      data: {
        jobId: job.id,
        createdById: actor.id,
        title: input.title,
        brief: input.brief ?? "",
        referenceLink: input.referenceLink,
        dueAt: input.dueAt,
        assigneeId: input.assigneeId,
      },
    });
    await logActivity(tx, {
      actorId: actor.id,
      action: "task.created",
      entityType: "task",
      entityId: created.id,
      jobId: job.id,
      taskId: created.id,
    });
    // Picking an editor at creation time must also move the task out of DRAFT —
    // otherwise it sits "assigned" with no ASSIGNED-only actions (Start task, upload) ever visible.
    let emails: Awaited<ReturnType<typeof createNotifications>> = [];
    if (assignee) {
      await transitionTask(tx, created, TaskStatus.ASSIGNED, actor);
      emails = await createNotifications(tx, [
        {
          userId: assignee.id,
          userEmail: assignee.email,
          type: "TASK_ASSIGNED",
          taskId: created.id,
          actorId: actor.id,
          message: `New task assigned: "${created.title}"`,
        },
      ]);
    }
    return { task: created, emails };
  });
  await sendEmails(emails);
  return task;
}

export async function updateTaskBrief(
  taskId: string,
  patch: { title?: string; brief?: string; referenceLink?: string | null; dueAt?: Date | null },
) {
  const task = await getTaskOrThrow(taskId);
  const actor = await authorize("task.write", task);
  if (task.status === "POSTED" || task.status === "CANCELLED")
    throw new ValidationError("Task is closed");

  await runTx(async (tx) => {
    await tx.task.update({ where: { id: taskId }, data: patch });
    await logActivity(tx, {
      actorId: actor.id,
      action: "task.updated",
      entityType: "task",
      entityId: taskId,
      jobId: task.jobId,
      taskId,
      meta: { fields: Object.keys(patch) },
    });
  });
}

// ---------- Assignment ----------

export async function assignTask(taskId: string, assigneeId: string, dueAt?: Date) {
  const task = await getTaskOrThrow(taskId);
  const actor = await authorize("task.assign", task);

  const assignee = await db.user.findUnique({ where: { id: assigneeId } });
  if (!assignee?.isActive || assignee.role !== "EDITOR")
    throw new ValidationError("Assignee must be an active editor");

  const emails = await runTx(async (tx) => {
    if (task.status === "DRAFT") {
      if (!task.brief.trim() && !(await tx.file.findFirst({ where: { taskId } })))
        throw new ValidationError("Write a brief (or attach a guide) before assigning");
      await tx.task.update({ where: { id: taskId }, data: { assigneeId, dueAt: dueAt ?? task.dueAt } });
      await transitionTask(tx, task, TaskStatus.ASSIGNED, actor);
    } else {
      if (["POSTED", "CANCELLED", "APPROVED"].includes(task.status))
        throw new ValidationError("Task can no longer be reassigned");
      await tx.task.update({ where: { id: taskId }, data: { assigneeId, dueAt: dueAt ?? task.dueAt } });
      await invalidatePendingUploads(tx, taskId);
      await logActivity(tx, {
        actorId: actor.id,
        action: "task.reassigned",
        entityType: "task",
        entityId: taskId,
        jobId: task.jobId,
        taskId,
        meta: { from: task.assigneeId, to: assigneeId },
      });
    }
    return createNotifications(tx, [
      {
        userId: assignee.id,
        userEmail: assignee.email,
        type: "TASK_ASSIGNED",
        taskId,
        actorId: actor.id,
        message: `New task assigned: "${task.title}"`,
      },
    ]);
  });
  await sendEmails(emails);
}

// ---------- Editor flow ----------

export async function startTask(taskId: string) {
  const task = await getTaskOrThrow(taskId);
  const actor = await authorize("submission.create", task);
  if (task.status !== "ASSIGNED") throw new ConflictError();

  await runTx(async (tx) => {
    await transitionTask(tx, task, TaskStatus.IN_PROGRESS, actor);
    await tx.submission.create({
      data: { taskId, round: 1, submittedById: actor.id },
    });
    await logActivity(tx, {
      actorId: actor.id,
      action: "submission.round_opened",
      entityType: "submission",
      entityId: taskId,
      jobId: task.jobId,
      taskId,
      meta: { round: 1 },
    });
  });
}

export async function startRevision(taskId: string) {
  const task = await getTaskOrThrow(taskId);
  const actor = await authorize("submission.create", task);
  if (task.status !== "CHANGES_REQUESTED") throw new ConflictError();

  await runTx(async (tx) => {
    await transitionTask(tx, task, TaskStatus.IN_PROGRESS, actor);
    const last = await tx.submission.findFirst({
      where: { taskId },
      orderBy: { round: "desc" },
      select: { round: true },
    });
    const round = (last?.round ?? 0) + 1;
    await tx.submission.create({ data: { taskId, round, submittedById: actor.id } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "submission.round_opened",
      entityType: "submission",
      entityId: taskId,
      jobId: task.jobId,
      taskId,
      meta: { round },
    });
  });
}

export async function submitForReview(taskId: string, note?: string) {
  const task = await getTaskOrThrow(taskId);
  const actor = await authorize("submission.create", task);
  if (task.status !== "IN_PROGRESS") throw new ConflictError();

  const emails = await runTx(async (tx) => {
    const open = await tx.submission.findFirst({
      where: { taskId, submittedAt: null },
      orderBy: { round: "desc" },
      include: { _count: { select: { files: true } } },
    });
    if (!open) throw new ConflictError();
    if (open._count.files === 0)
      throw new ValidationError("Upload at least one deliverable before submitting");

    await tx.submission.update({
      where: { id: open.id },
      data: { note, submittedAt: new Date() },
    });
    await transitionTask(tx, task, TaskStatus.SUBMITTED, actor);

    const manager = await tx.user.findUnique({ where: { id: task.job.managerId } });
    const inputs: NotificationInput[] = manager
      ? [
          {
            userId: manager.id,
            userEmail: manager.email,
            type: "SUBMISSION_RECEIVED",
            taskId,
            actorId: actor.id,
            message: `Round ${open.round} submitted for review: "${task.title}"`,
          },
        ]
      : [];
    return createNotifications(tx, inputs);
  });
  await sendEmails(emails);
}

// ---------- Review ----------

export async function reviewSubmission(taskId: string, decision: ReviewDecision, comment?: string) {
  const task = await getTaskOrThrow(taskId);
  const actor = await authorize("review.decide", task);
  if (task.status !== "SUBMITTED") throw new ConflictError();
  if (decision === "CHANGES_REQUESTED" && !comment?.trim())
    throw new ValidationError("Feedback comment is required when requesting changes");

  const emails = await runTx(async (tx) => {
    const submission = await tx.submission.findFirst({
      where: { taskId, submittedAt: { not: null }, review: null },
      orderBy: { round: "desc" },
    });
    if (!submission) throw new ConflictError();

    // @unique on submissionId backstops double-review; P2002 -> 409 via runTx
    await tx.reviewAction.create({
      data: { submissionId: submission.id, reviewerId: actor.id, decision, comment },
    });
    await logActivity(tx, {
      actorId: actor.id,
      action: decision === "APPROVED" ? "review.approved" : "review.changes_requested",
      entityType: "submission",
      entityId: submission.id,
      jobId: task.jobId,
      taskId,
      meta: { round: submission.round },
    });

    const to = decision === "APPROVED" ? TaskStatus.APPROVED : TaskStatus.CHANGES_REQUESTED;
    await transitionTask(tx, task, to, actor);
    if (decision === "APPROVED") await invalidatePendingUploads(tx, taskId);

    if (!task.assignee) return [];
    return createNotifications(tx, [
      {
        userId: task.assignee.id,
        userEmail: task.assignee.email,
        type: decision === "APPROVED" ? "TASK_APPROVED" : "CHANGES_REQUESTED",
        taskId,
        actorId: actor.id,
        message:
          decision === "APPROVED"
            ? `Approved: "${task.title}"`
            : `Changes requested on "${task.title}": ${comment?.trim()}`,
      },
    ]);
  });
  await sendEmails(emails);
}

// ---------- Close out ----------

export async function markPosted(taskId: string, postUrl?: string) {
  const task = await getTaskOrThrow(taskId);
  const actor = await authorize("task.markPosted", task);
  if (task.status !== "APPROVED") throw new ConflictError();

  const emails = await runTx(async (tx) => {
    await transitionTask(tx, task, TaskStatus.POSTED, actor, {
      postedAt: new Date(),
      postUrl: postUrl || null,
    });
    if (!task.assignee) return [];
    return createNotifications(tx, [
      {
        userId: task.assignee.id,
        userEmail: task.assignee.email,
        type: "TASK_POSTED",
        taskId,
        actorId: actor.id,
        message: `Posted and closed: "${task.title}"`,
      },
    ]);
  });
  await sendEmails(emails);
}

export async function cancelTask(taskId: string, reason: string) {
  const task = await getTaskOrThrow(taskId);
  const actor = await authorize("task.cancel", task);
  if (["POSTED", "CANCELLED"].includes(task.status)) throw new ValidationError("Task is closed");
  if (!reason.trim()) throw new ValidationError("A cancellation reason is required");

  const emails = await runTx(async (tx) => {
    await transitionTask(tx, task, TaskStatus.CANCELLED, actor);
    await invalidatePendingUploads(tx, taskId);
    await tx.comment.create({
      data: { taskId, authorId: actor.id, body: `Task cancelled: ${reason.trim()}` },
    });
    if (!task.assignee || task.assignee.id === actor.id) return [];
    return createNotifications(tx, [
      {
        userId: task.assignee.id,
        userEmail: task.assignee.email,
        type: "COMMENT_ADDED",
        taskId,
        actorId: actor.id,
        message: `Cancelled: "${task.title}" — ${reason.trim()}`,
      },
    ]);
  });
  await sendEmails(emails);
}

// ---------- Comments ----------

export async function addComment(taskId: string, body: string) {
  const task = await getTaskOrThrow(taskId);
  const actor = await authorize("comment.create", task);
  if (!body.trim()) throw new ValidationError("Comment cannot be empty");

  const emails = await runTx(async (tx) => {
    await tx.comment.create({ data: { taskId, authorId: actor.id, body: body.trim() } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "comment.added",
      entityType: "comment",
      entityId: taskId,
      jobId: task.jobId,
      taskId,
    });

    // Notify the other side of the conversation: manager + assignee, minus author.
    const recipients = [task.job.managerId, task.assigneeId].filter(
      (id): id is string => !!id && id !== actor.id,
    );
    const users = await tx.user.findMany({ where: { id: { in: recipients }, isActive: true } });
    return createNotifications(
      tx,
      users.map((u) => ({
        userId: u.id,
        userEmail: u.email,
        type: "COMMENT_ADDED" as const,
        taskId,
        actorId: actor.id,
        message: `${actor.name ?? "Someone"} commented on "${task.title}"`,
      })),
    );
  });
  await sendEmails(emails);
}

import { TaskStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { ConflictError } from "@/lib/errors";
import type { DbClient } from "@/lib/activity";
import { logActivity } from "@/lib/activity";
import type { SessionUser, TaskResource } from "@/lib/permissions";

const managesTask = (u: SessionUser, t: TaskResource) =>
  u.role === "ADMIN" || (u.role === "MANAGER" && t.job.managerId === u.id);

const isAssignee = (u: SessionUser, t: TaskResource) =>
  u.role === "ADMIN" || (u.role === "EDITOR" && t.assigneeId === u.id);

type Can = (u: SessionUser, t: TaskResource) => boolean;

export const TERMINAL_STATUSES: TaskStatus[] = [TaskStatus.POSTED, TaskStatus.CANCELLED];

// Single source of truth for the task state machine.
// UI action buttons are derived from this map but it is enforced server-side.
const TRANSITIONS: Partial<Record<TaskStatus, Partial<Record<TaskStatus, Can>>>> = {
  DRAFT: {
    ASSIGNED: (u, t) => u.role === "CEO" || managesTask(u, t),
    CANCELLED: (u, t) => u.role === "CEO" || managesTask(u, t),
  },
  ASSIGNED: {
    IN_PROGRESS: isAssignee,
    CANCELLED: (u, t) => u.role === "CEO" || managesTask(u, t),
  },
  IN_PROGRESS: {
    SUBMITTED: isAssignee,
    CANCELLED: (u, t) => u.role === "CEO" || managesTask(u, t),
  },
  SUBMITTED: {
    CHANGES_REQUESTED: managesTask,
    APPROVED: managesTask,
    CANCELLED: (u, t) => u.role === "CEO" || managesTask(u, t),
  },
  CHANGES_REQUESTED: {
    IN_PROGRESS: isAssignee,
    CANCELLED: (u, t) => u.role === "CEO" || managesTask(u, t),
  },
  APPROVED: {
    POSTED: managesTask,
    CANCELLED: (u, t) => u.role === "CEO" || managesTask(u, t),
  },
};

export function canTransition(
  user: SessionUser,
  task: TaskResource & { status: TaskStatus },
  to: TaskStatus,
): boolean {
  const rule = TRANSITIONS[task.status]?.[to];
  return !!rule && rule(user, task);
}

export function allowedTransitions(
  user: SessionUser,
  task: TaskResource & { status: TaskStatus },
): TaskStatus[] {
  const edges = TRANSITIONS[task.status] ?? {};
  return (Object.keys(edges) as TaskStatus[]).filter((to) => canTransition(user, task, to));
}

/**
 * Compare-and-swap status transition. Must run inside the caller's transaction
 * together with the triggering write (submission/review/etc.).
 * Throws ConflictError (409) if the task moved concurrently.
 */
export async function transitionTask(
  tx: DbClient,
  task: { id: string; jobId: string; status: TaskStatus },
  to: TaskStatus,
  actor: SessionUser,
  extraData: Prisma.TaskUpdateManyMutationInput = {},
) {
  const { count } = await tx.task.updateMany({
    where: { id: task.id, status: task.status },
    data: { status: to, ...extraData },
  });
  if (count === 0) throw new ConflictError();

  await logActivity(tx, {
    actorId: actor.id,
    action: "task.status_changed",
    entityType: "task",
    entityId: task.id,
    jobId: task.jobId,
    taskId: task.id,
    meta: { from: task.status, to },
  });
}

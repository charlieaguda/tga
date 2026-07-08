import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { ValidationError } from "@/lib/errors";
import { hashPassword } from "@/lib/services/auth-credentials";

export async function createUser(input: {
  email: string;
  name: string;
  role: Role;
  password: string;
}) {
  const actor = await authorize("user.manage");
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  return db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, name: input.name.trim(), role: input.role, passwordHash },
    });
    await logActivity(tx, {
      actorId: actor.id,
      action: "user.created",
      entityType: "user",
      entityId: user.id,
      meta: { role: input.role },
    });
    return user;
  });
}

export async function setUserRole(userId: string, role: Role) {
  const actor = await authorize("user.manage");
  if (userId === actor.id) throw new ValidationError("You cannot change your own role");

  await db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: userId } });
    if (!before) throw new ValidationError("User not found");
    await tx.user.update({ where: { id: userId }, data: { role } });
    // Role changes take effect immediately: kill existing sessions.
    await tx.session.deleteMany({ where: { userId } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "user.role_changed",
      entityType: "user",
      entityId: userId,
      meta: { from: before.role, to: role },
    });
  });
}

export async function setUserActive(userId: string, isActive: boolean) {
  const actor = await authorize("user.manage");
  if (userId === actor.id) throw new ValidationError("You cannot deactivate yourself");

  await db.$transaction(async (tx) => {
    if (!isActive) {
      // Block offboarding while the user still owns live work.
      const managedJobs = await tx.job.count({
        where: { managerId: userId, status: { not: "ARCHIVED" } },
      });
      if (managedJobs > 0)
        throw new ValidationError(
          `User still manages ${managedJobs} active job(s) — reassign the jobs first`,
        );
      const openTasks = await tx.task.count({
        where: { assigneeId: userId, status: { notIn: ["POSTED", "CANCELLED"] } },
      });
      if (openTasks > 0)
        throw new ValidationError(
          `User still has ${openTasks} open task(s) — reassign them first`,
        );
    }
    await tx.user.update({ where: { id: userId }, data: { isActive } });
    if (!isActive) await tx.session.deleteMany({ where: { userId } });
    await logActivity(tx, {
      actorId: actor.id,
      action: isActive ? "user.activated" : "user.deactivated",
      entityType: "user",
      entityId: userId,
    });
  });
}

export async function reassignJobManager(jobId: string, newManagerId: string) {
  const actor = await authorize("user.manage");
  const [job, manager] = await Promise.all([
    db.job.findUnique({ where: { id: jobId } }),
    db.user.findUnique({ where: { id: newManagerId } }),
  ]);
  if (!job) throw new ValidationError("Job not found");
  if (!manager?.isActive || (manager.role !== "MANAGER" && manager.role !== "ADMIN"))
    throw new ValidationError("New manager must be an active manager");

  await db.$transaction(async (tx) => {
    await tx.job.update({ where: { id: jobId }, data: { managerId: newManagerId } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "job.manager_reassigned",
      entityType: "job",
      entityId: jobId,
      jobId,
      meta: { from: job.managerId, to: newManagerId },
    });
  });
}

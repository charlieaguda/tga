import { JobStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { logActivity } from "@/lib/activity";
import { ValidationError } from "@/lib/errors";

export async function createClient(input: { name: string; notes?: string }) {
  const actor = await authorize("client.write");
  const name = input.name.trim();
  if (!name) throw new ValidationError("Client name is required");

  return db.$transaction(async (tx) => {
    const client = await tx.client.create({ data: { name, notes: input.notes?.trim() } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "client.created",
      entityType: "client",
      entityId: client.id,
    });
    return client;
  });
}

export async function setClientActive(clientId: string, isActive: boolean) {
  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) throw new ValidationError("Client not found");
  const actor = await authorize("client.deactivate");

  if (!isActive) {
    const activeJobs = await db.job.count({
      where: { clientId, status: { not: "ARCHIVED" } },
    });
    if (activeJobs > 0)
      throw new ValidationError(
        `Client has ${activeJobs} job(s) that aren't archived — archive them first`,
      );
  }

  await db.$transaction(async (tx) => {
    await tx.client.update({ where: { id: clientId }, data: { isActive } });
    await logActivity(tx, {
      actorId: actor.id,
      action: isActive ? "client.reactivated" : "client.deactivated",
      entityType: "client",
      entityId: clientId,
    });
  });
}

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

export async function setJobDefaultEditor(jobId: string, editorId: string | null) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw new ValidationError("Job not found");
  const actor = await authorize("job.write", job);

  if (editorId) {
    const editor = await db.user.findUnique({ where: { id: editorId } });
    if (!editor?.isActive || editor.role !== "EDITOR")
      throw new ValidationError("Default editor must be an active editor");
  }

  await db.$transaction(async (tx) => {
    await tx.job.update({ where: { id: jobId }, data: { defaultEditorId: editorId } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "job.default_editor_changed",
      entityType: "job",
      entityId: jobId,
      jobId,
      meta: { from: job.defaultEditorId, to: editorId },
    });
  });
}

export async function setJobStatus(jobId: string, status: JobStatus) {
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) throw new ValidationError("Job not found");
  const actor = await authorize("job.write", job);

  if (status === "ARCHIVED") {
    const openTasks = await db.task.count({
      where: { jobId, status: { notIn: ["POSTED", "CANCELLED"] } },
    });
    if (openTasks > 0)
      throw new ValidationError(`Job has ${openTasks} open task(s) — close or cancel them first`);
  }

  await db.$transaction(async (tx) => {
    await tx.job.update({ where: { id: jobId }, data: { status } });
    await logActivity(tx, {
      actorId: actor.id,
      action: "job.status_changed",
      entityType: "job",
      entityId: jobId,
      jobId,
      meta: { from: job.status, to: status },
    });
  });
}

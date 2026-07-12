import type { Prisma, PrismaClient } from "@prisma/client";

export type DbClient = PrismaClient | Prisma.TransactionClient;

export type ActivityInput = {
  actorId: string | null;
  action: string; // dotted verb, e.g. "task.status_changed"
  entityType: "task" | "job" | "client" | "submission" | "user" | "file" | "comment" | "category" | "drive_connection";
  entityId: string;
  jobId?: string;
  taskId?: string;
  clientId?: string;
  meta?: Prisma.InputJsonValue; // never secrets/PII
};

// Append-only: nothing in the app ever updates or deletes ActivityLog rows.
export async function logActivity(tx: DbClient, input: ActivityInput) {
  await tx.activityLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      jobId: input.jobId,
      taskId: input.taskId,
      clientId: input.clientId,
      meta: input.meta,
    },
  });
}

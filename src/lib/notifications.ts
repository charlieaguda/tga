import type { NotificationType } from "@prisma/client";
import type { DbClient } from "@/lib/activity";
import type { OutgoingEmail } from "@/lib/email";

export type NotificationInput = {
  userId: string;
  userEmail?: string | null; // when present and emailable, an email is queued too
  type: NotificationType;
  taskId?: string;
  actorId?: string;
  message: string; // pre-rendered plain text, safe to display
};

const APP_URL = process.env.AUTH_URL ?? "http://localhost:3000";

/**
 * Insert in-app notification rows inside the caller's transaction and return
 * the emails to send AFTER commit (caller passes them to sendEmails()).
 */
export async function createNotifications(
  tx: DbClient,
  inputs: NotificationInput[],
): Promise<OutgoingEmail[]> {
  if (inputs.length === 0) return [];
  await tx.notification.createMany({
    data: inputs.map((n) => ({
      userId: n.userId,
      type: n.type,
      taskId: n.taskId,
      actorId: n.actorId,
      message: n.message,
    })),
  });
  return inputs
    .filter((n) => !!n.userEmail)
    .map((n) => ({
      to: n.userEmail as string,
      subject: `[TGA] ${n.message}`,
      text: n.taskId ? `${n.message}\n\nOpen the task: ${APP_URL}/tasks/${n.taskId}` : n.message,
    }));
}

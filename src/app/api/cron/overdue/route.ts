import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { createNotifications } from "@/lib/notifications";
import { sendEmails } from "@/lib/email";
import { fmtDate } from "@/lib/format";

const REMIND_EVERY_MS = 3 * 86_400_000; // first crossing, then every 3 days

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const now = new Date();
  const tasks = await db.task.findMany({
    where: {
      status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"] },
      dueAt: { lt: now },
      OR: [
        { lastOverdueNotifiedAt: null },
        { lastOverdueNotifiedAt: { lt: new Date(now.getTime() - REMIND_EVERY_MS) } },
      ],
    },
    include: { assignee: true, job: { include: { manager: true, client: true } } },
    take: 200,
  });

  let notified = 0;
  for (const task of tasks) {
    const recipients = [task.assignee, task.job.manager].filter(
      (u, i, arr): u is NonNullable<typeof u> =>
        !!u && u.isActive && arr.findIndex((x) => x?.id === u.id) === i,
    );
    const emails = await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: task.id }, data: { lastOverdueNotifiedAt: now } });
      return createNotifications(
        tx,
        recipients.map((u) => ({
          userId: u.id,
          userEmail: u.email,
          type: "OVERDUE" as const,
          taskId: task.id,
          message: `Overdue: "${task.title}" (${task.job.client.name}) was due ${fmtDate(task.dueAt)}`,
        })),
      );
    });
    await sendEmails(emails);
    notified++;
  }

  return NextResponse.json({ checked: tasks.length, notified });
}

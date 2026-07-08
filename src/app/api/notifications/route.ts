import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { errorToStatus } from "@/lib/errors";

export async function GET() {
  try {
    const user = await requireUser();
    const [unread, items] = await Promise.all([
      db.notification.count({ where: { userId: user.id, readAt: null } }),
      db.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: { id: true, message: true, taskId: true, readAt: true, createdAt: true },
      }),
    ]);
    return NextResponse.json({ unread, items });
  } catch (err) {
    return NextResponse.json({ error: "unauthorized" }, { status: errorToStatus(err) });
  }
}

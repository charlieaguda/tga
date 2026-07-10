import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { reconcileUploads } from "@/lib/services/uploads";
import { reconcileClientUploads } from "@/lib/services/client-files";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const [tasks, clientHub] = await Promise.all([reconcileUploads(), reconcileClientUploads()]);
    return NextResponse.json({ ...tasks, clientHubRelinked: clientHub.relinked });
  } catch (err) {
    console.error("[cron] reconcile failed:", err);
    return NextResponse.json({ error: "reconcile failed" }, { status: 500 });
  }
}

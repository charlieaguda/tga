import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { reconcileUploads } from "@/lib/services/uploads";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  try {
    const result = await reconcileUploads();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cron] reconcile failed:", err);
    return NextResponse.json({ error: "reconcile failed" }, { status: 500 });
  }
}

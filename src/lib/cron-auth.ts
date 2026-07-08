import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** Constant-time check of the cron secret (Vercel Cron sends Authorization: Bearer <CRON_SECRET>). */
export function isCronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const provided =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    req.headers.get("x-cron-secret") ??
    "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

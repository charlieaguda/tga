import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { randomBytes } from "node:crypto";
import { authorize } from "@/lib/permissions";

export async function GET() {
  const base = process.env.AUTH_URL ?? "http://localhost:3030";

  try {
    // Fail fast here (rather than only inside connectDrive() at the callback)
    // so a non-admin never gets redirected to Google's consent screen at all.
    await authorize("drive.manage");
  } catch {
    return NextResponse.redirect(new URL("/admin/drive?error=unauthorized", base));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/admin/drive?error=oauth_client_not_configured", base));
  }

  const redirectUri = `${base}/api/admin/drive/callback`;
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const state = randomBytes(16).toString("hex");

  const cookieStore = await cookies();
  cookieStore.set("drive_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/drive", "https://www.googleapis.com/auth/userinfo.email"],
    state,
  });

  return NextResponse.redirect(url);
}

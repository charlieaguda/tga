import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { authorize } from "@/lib/permissions";
import { connectDrive } from "@/lib/services/drive-connection";

export async function GET(req: NextRequest) {
  const base = process.env.AUTH_URL ?? "http://localhost:3030";

  try {
    await authorize("drive.manage");
  } catch {
    return NextResponse.redirect(new URL("/admin/drive?error=unauthorized", base));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("drive_oauth_state")?.value;
  cookieStore.delete("drive_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/admin/drive?error=invalid_state", base));
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/admin/drive?error=oauth_client_not_configured", base));
  }

  try {
    const redirectUri = `${base}/api/admin/drive/callback`;
    const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return NextResponse.redirect(new URL("/admin/drive?error=no_refresh_token", base));
    }
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    if (!data.email) {
      return NextResponse.redirect(new URL("/admin/drive?error=no_email", base));
    }

    await connectDrive({ googleAccountEmail: data.email, refreshToken: tokens.refresh_token });

    return NextResponse.redirect(new URL("/admin/drive?connected=1", base));
  } catch (err) {
    console.error("[drive-callback] failed:", err instanceof Error ? err.message : String(err));
    return NextResponse.redirect(new URL("/admin/drive?error=callback_failed", base));
  }
}

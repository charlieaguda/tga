import { NextResponse, type NextRequest } from "next/server";

// Optimistic redirect only (session cookie presence). NOT a security boundary:
// every route handler and server action enforces auth via authorize().
export default function proxy(req: NextRequest) {
  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token");

  if (!hasSession && req.nextUrl.pathname !== "/login") {
    const url = new URL("/login", req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // API routes self-protect (401/403 JSON via requireUser/authorize) — pages only here.
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|logo.webp).*)"],
};

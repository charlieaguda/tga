import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

const SESSION_DAYS = 30;

// Must match what Auth.js reads: secure-prefixed cookie on https.
export function sessionCookieName(): string {
  return (process.env.AUTH_URL ?? "").startsWith("https")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

/** Mint a DB session (same table Auth.js reads) and set the session cookie. */
export async function createSessionForUser(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { sessionToken: token, userId, expires } });
  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieName().startsWith("__Secure-"),
    path: "/",
    expires,
  });
}

/** Delete the current session row and clear the cookie. */
export async function destroySession() {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (token) await db.session.deleteMany({ where: { sessionToken: token } });
  // store.delete() omits `secure`, which browsers require to accept a
  // Set-Cookie for a __Secure- prefixed name — the deletion would be
  // silently ignored over https. Match the attributes used when setting it.
  store.set(sessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: sessionCookieName().startsWith("__Secure-"),
    path: "/",
    maxAge: 0,
  });
}

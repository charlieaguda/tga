import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { db } from "@/lib/db";

// Auth = email + password accounts managed inside the app (created by an
// Admin in /admin/users; passwords bcrypt-hashed, never stored in plain text).
// Sign-in itself is handled by the loginWithPassword server action, which
// mints a database session row + cookie; NextAuth here only READS those
// sessions (auth() in layouts/services) via the Prisma adapter.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "database" },
  providers: [],
  pages: { signIn: "/login" },
  callbacks: {
    async session({ session, user }) {
      // `user` is the DB row (database sessions) — role is fresh every request.
      session.user.id = user.id;
      session.user.username = user.username;
      session.user.role = user.role;
      session.user.isActive = user.isActive;
      session.user.clientId = user.clientId;
      return session;
    },
  },
});

import type { Role } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: Role;
      isActive: boolean;
      clientId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    username: string;
    role: Role;
    isActive: boolean;
    clientId: string | null;
  }
}

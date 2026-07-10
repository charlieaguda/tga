import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { auth } from "@/auth";
import { logout } from "@/lib/actions";
import { NotificationBell } from "@/components/notification-bell";
import { NavLink } from "@/components/nav-links";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TGA Workflow",
  description: "The Growth Academy — social media job workflow organizer",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const user = session?.user;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col text-slate-900 dark:text-slate-100">
        {user && (
          <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
            <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3">
              <Link href="/dashboard" className="mr-3 flex items-center gap-2">
                <Image
                  src="/logo.webp"
                  alt="The Growth Academy"
                  width={112}
                  height={28}
                  priority
                  className="h-7 w-auto rounded-md bg-white p-0.5"
                />
              </Link>
              <NavLink href="/dashboard">Dashboard</NavLink>
              {user.role !== "CLIENT" && <NavLink href="/jobs">Jobs</NavLink>}
              <NavLink href="/client-hub">Client Hub</NavLink>
              {(user.role === "ADMIN" || user.role === "MANAGER") && (
                <NavLink href="/clients">Clients</NavLink>
              )}
              {user.role === "ADMIN" && <NavLink href="/admin/users">Users</NavLink>}
              <span className="ml-auto flex items-center gap-3 text-sm">
                <NotificationBell />
                <Link
                  href="/account"
                  className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  {user.name} <span className="text-slate-400 dark:text-slate-600">·</span>{" "}
                  {user.role.toLowerCase()}
                </Link>
                <form action={logout}>
                  <button className="cursor-pointer rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                    Sign out
                  </button>
                </form>
              </span>
            </nav>
          </header>
        )}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

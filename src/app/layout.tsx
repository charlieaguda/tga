import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { auth } from "@/auth";
import { logout } from "@/lib/actions";
import { NotificationBell } from "@/components/notification-bell";

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
      <body className="min-h-full flex flex-col bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        {user && (
          <header className="border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
              <Link href="/dashboard" className="font-semibold">
                TGA Workflow
              </Link>
              <Link href="/dashboard" className="text-sm hover:underline">
                Dashboard
              </Link>
              <Link href="/jobs" className="text-sm hover:underline">
                Jobs
              </Link>
              {(user.role === "ADMIN" || user.role === "MANAGER") && (
                <Link href="/clients" className="text-sm hover:underline">
                  Clients
                </Link>
              )}
              {user.role === "ADMIN" && (
                <Link href="/admin/users" className="text-sm hover:underline">
                  Users
                </Link>
              )}
              <span className="ml-auto flex items-center gap-3 text-sm">
                <NotificationBell />
                <Link
                  href="/account"
                  className="text-gray-500 hover:underline dark:text-gray-400"
                >
                  {user.name} · {user.role.toLowerCase()}
                </Link>
                <form action={logout}>
                  <button className="rounded-md border border-gray-300 px-2.5 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800">
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

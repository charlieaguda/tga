import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { auth } from "@/auth";
import { logout } from "@/lib/actions";
import { NotificationBell } from "@/components/notification-bell";
import { NavLink } from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";

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
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('theme') || 'system';
                const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
                if (isDark) {
                  document.documentElement.classList.add('dark');
                  document.documentElement.classList.remove('light');
                } else {
                  document.documentElement.classList.add('light');
                  document.documentElement.classList.remove('dark');
                }
              } catch (_) {}
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col text-slate-900 dark:text-slate-100">
        {user && (
          <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/70 backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-950/70 shadow-sm transition-colors">
            <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1.5 gap-y-2 px-4 py-3">
              <Link href="/dashboard" className="mr-3 flex items-center gap-2">
                <Image
                  src="/logo.webp"
                  alt="The Growth Academy"
                  width={144}
                  height={36}
                  priority
                  className="h-9 w-auto rounded-md bg-white p-0.5 shadow-sm"
                  style={{ height: "auto" }}
                />
              </Link>
              <NavLink href="/dashboard">Dashboard</NavLink>
              {user.role !== "CLIENT" && <NavLink href="/jobs">Jobs</NavLink>}
              <NavLink href="/client-hub">Client Hub</NavLink>
              {(user.role === "ADMIN" || user.role === "MANAGER") && (
                <NavLink href="/clients">Clients</NavLink>
              )}
              {user.role === "ADMIN" && <NavLink href="/admin/users">Users</NavLink>}
              <span className="ml-auto flex items-center gap-2 text-sm">
                <NotificationBell />
                <ThemeToggle />
                <Link
                  href="/account"
                  className="text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 transition-colors"
                >
                  {user.name} <span className="text-slate-400 dark:text-slate-600">·</span>{" "}
                  {user.role.toLowerCase()}
                </Link>
                <form action={logout}>
                  <button className="cursor-pointer rounded-xl border border-slate-200/80 bg-white/50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-all hover:bg-slate-100 hover:scale-[1.02] active:scale-[0.98] dark:border-slate-800/80 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800">
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


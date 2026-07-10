import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loginWithPassword } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <Image
          src="/logo.webp"
          alt="The Growth Academy"
          width={160}
          height={40}
          priority
          className="mx-auto h-10 w-auto"
        />
        <p className="mt-4 text-center text-sm text-slate-500 dark:text-slate-400">
          Sign in with your work account.
        </p>
        <div className="mt-6">
          <ActionForm
            action={loginWithPassword}
            submitLabel="Sign in"
            resetOnSuccess={false}
            className="flex flex-col gap-3"
          >
            <input
              name="username"
              type="text"
              required
              autoComplete="username"
              placeholder="Username"
              className="rounded-xl border border-slate-200/80 bg-white/50 px-3.5 py-2.5 text-sm backdrop-blur-sm shadow-sm transition-all focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800/80 dark:bg-slate-900/50 dark:focus:border-brand-500 dark:focus:bg-slate-950"
            />
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password"
              className="rounded-xl border border-slate-200/80 bg-white/50 px-3.5 py-2.5 text-sm backdrop-blur-sm shadow-sm transition-all focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800/80 dark:bg-slate-900/50 dark:focus:border-brand-500 dark:focus:bg-slate-950"
            />
          </ActionForm>
          <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
            No account or forgot your password? Ask an admin — they manage accounts under Users.
          </p>
        </div>
      </div>
    </div>
  );
}

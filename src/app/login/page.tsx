import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { loginWithPassword } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900">
        <h1 className="text-center text-xl font-semibold">TGA Workflow</h1>
        <p className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">
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
              className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
          </ActionForm>
          <p className="mt-4 text-xs text-gray-400">
            No account or forgot your password? Ask an admin — they manage accounts under Users.
          </p>
        </div>
      </div>
    </div>
  );
}

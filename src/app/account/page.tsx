import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { changeOwnPassword } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";

export default async function AccountPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <h1 className="text-xl font-semibold">My account</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {user.name} · {user.username} · {user.role.toLowerCase()}
      </p>
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Change password
        </h2>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          You&apos;ll be signed out everywhere and need to sign in again.
        </p>
        <ActionForm action={changeOwnPassword} submitLabel="Change password" className="flex flex-col gap-2">
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Current password"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          />
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="New password (min 8 characters)"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          />
        </ActionForm>
      </div>
    </div>
  );
}

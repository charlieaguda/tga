import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { changeOwnPassword } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Section } from "@/components/ui";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800";

export default async function AccountPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <PageHeader
        title="My account"
        description={`${user.name} · ${user.username} · ${user.role.toLowerCase()}`}
      />
      <Section title="Change password">
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          You&apos;ll be signed out everywhere and need to sign in again.
        </p>
        <ActionForm action={changeOwnPassword} submitLabel="Change password" className="flex flex-col gap-2">
          <input
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Current password"
            className={inputCls}
          />
          <input
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="New password (min 8 characters)"
            className={inputCls}
          />
        </ActionForm>
      </Section>
    </div>
  );
}

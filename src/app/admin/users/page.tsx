import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { adminCreateUser, adminSetActive, adminSetPassword, adminSetRole } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";

const ROLES = Object.values(Role);

export default async function UsersPage() {
  const session = await auth();
  const me = session?.user;
  if (!me?.isActive) redirect("/login");
  if (me.role !== "ADMIN") redirect("/dashboard");

  const users = await db.user.findMany({ orderBy: [{ isActive: "desc" }, { name: "asc" }] });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Users</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 font-medium">Password</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                  <td className="py-2.5 pr-4 font-medium">
                    {u.name}
                    {u.id === me.id && <span className="text-xs text-gray-400"> (you)</span>}
                  </td>
                  <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{u.email}</td>
                  <td className="py-2.5 pr-4">
                    {u.id === me.id ? (
                      u.role.toLowerCase()
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {ROLES.map((r) => (
                          <ActionButton
                            key={r}
                            action={adminSetRole.bind(null, u.id, r)}
                            label={r.toLowerCase()}
                            variant={u.role === r ? "primary" : "neutral"}
                          />
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    {u.id === me.id ? (
                      "active"
                    ) : u.isActive ? (
                      <ActionButton
                        action={adminSetActive.bind(null, u.id, false)}
                        label="Deactivate"
                        variant="danger"
                        confirm={`Deactivate ${u.name}? They will be signed out immediately.`}
                      />
                    ) : (
                      <ActionButton
                        action={adminSetActive.bind(null, u.id, true)}
                        label="Reactivate"
                        variant="success"
                      />
                    )}
                  </td>
                  <td className="py-2.5">
                    <details>
                      <summary className="cursor-pointer select-none text-xs text-blue-600 hover:underline">
                        Reset…
                      </summary>
                      <ActionForm
                        action={adminSetPassword}
                        submitLabel="Set password"
                        className="mt-2 flex flex-col gap-2"
                      >
                        <input type="hidden" name="userId" value={u.id} />
                        <input
                          name="password"
                          type="password"
                          required
                          minLength={8}
                          autoComplete="new-password"
                          placeholder="New password (min 8)"
                          className="w-44 rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800"
                        />
                      </ActionForm>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Add user
        </h2>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
          Set a starting password and share it with them — they can change it under My account.
        </p>
        <ActionForm action={adminCreateUser} submitLabel="Add user" className="flex max-w-md flex-col gap-2">
          <input
            name="name"
            required
            placeholder="Full name"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          />
          <input
            name="email"
            type="email"
            required
            placeholder="name@company.com"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          />
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="Starting password (min 8 characters)"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          />
          <select
            name="role"
            required
            defaultValue="EDITOR"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.toLowerCase()}
              </option>
            ))}
          </select>
        </ActionForm>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { clientCreate, clientSetActive } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";

export default async function ClientsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role !== "ADMIN" && user.role !== "MANAGER") redirect("/dashboard");

  const clients = await db.client.findMany({
    include: { jobs: { where: { status: { not: "ARCHIVED" } }, select: { id: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Clients</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Active jobs</th>
              <th className="py-2 pr-4 font-medium">Notes</th>
              {user.role === "ADMIN" && <th className="py-2 font-medium">Status</th>}
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr
                key={c.id}
                className={`border-b border-gray-100 last:border-0 dark:border-gray-800 ${!c.isActive ? "opacity-50" : ""}`}
              >
                <td className="py-2.5 pr-4 font-medium">
                  {c.name}
                  {!c.isActive && <span className="text-xs text-gray-400"> (inactive)</span>}
                </td>
                <td className="py-2.5 pr-4">{c.jobs.length}</td>
                <td className="py-2.5 pr-4 whitespace-pre-wrap text-gray-600 dark:text-gray-300">
                  {c.notes ?? "—"}
                </td>
                {user.role === "ADMIN" && (
                  <td className="py-2.5">
                    {c.isActive ? (
                      <ActionButton
                        action={clientSetActive.bind(null, c.id, false)}
                        label="Deactivate"
                        variant="danger"
                        confirm={
                          c.jobs.length > 0
                            ? `${c.name} still has ${c.jobs.length} non-archived job(s) — archive them first.`
                            : `Deactivate ${c.name}? They'll be hidden from new job/task creation.`
                        }
                      />
                    ) : (
                      <ActionButton
                        action={clientSetActive.bind(null, c.id, true)}
                        label="Reactivate"
                        variant="success"
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={user.role === "ADMIN" ? 4 : 3} className="py-4 text-gray-500">
                  No clients yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Add client
        </h2>
        <ActionForm action={clientCreate} submitLabel="Add client" className="flex max-w-md flex-col gap-2">
          <input
            name="name"
            required
            placeholder="Client name"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          />
          <textarea
            name="notes"
            rows={2}
            placeholder="Notes: handles, brand guidelines links… (optional)"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
          />
        </ActionForm>
      </div>
    </div>
  );
}

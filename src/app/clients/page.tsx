import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { clientCreate, clientSetActive } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Section, EmptyState } from "@/components/ui";

const inputCls =
  "rounded-xl border border-slate-200/80 bg-white/50 px-3.5 py-2 text-sm backdrop-blur-sm shadow-sm transition-all focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800/80 dark:bg-slate-900/50 dark:focus:border-brand-500 dark:focus:bg-slate-950";

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
      <PageHeader title="Clients" />

      <Section title={`All clients (${clients.length})`}>
        {clients.length === 0 ? (
          <EmptyState>No clients yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
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
                    className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 ${!c.isActive ? "opacity-50" : ""}`}
                  >
                    <td className="py-2.5 pr-4 font-medium">
                      {c.name}
                      {!c.isActive && <span className="text-xs text-slate-400"> (inactive)</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{c.jobs.length}</td>
                    <td className="py-2.5 pr-4 whitespace-pre-wrap text-slate-600 dark:text-slate-300">
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
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Add client">
        <ActionForm action={clientCreate} submitLabel="Add client" className="flex max-w-md flex-col gap-2">
          <input name="name" required placeholder="Client name" className={inputCls} />
          <textarea
            name="notes"
            rows={2}
            placeholder="Notes: handles, brand guidelines links… (optional)"
            className={inputCls}
          />
        </ActionForm>
      </Section>
    </div>
  );
}

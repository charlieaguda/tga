import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { clientSetActive, clientSetDefaultManager, clientSetDefaultEditor } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { AddClientModal } from "@/components/add-client-modal";
import { PageHeader, Section, EmptyState } from "@/components/ui";

const inputCls =
  "rounded-xl border border-slate-200/80 bg-white/50 px-3.5 py-2 text-sm backdrop-blur-sm shadow-sm transition-all focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800/80 dark:bg-slate-900/50 dark:focus:border-brand-500 dark:focus:bg-slate-950";

export default async function ClientsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role !== "ADMIN" && user.role !== "MANAGER") redirect("/dashboard");

  const [clients, managers, editors] = await Promise.all([
    db.client.findMany({
      include: {
        jobs: { where: { status: { not: "ARCHIVED" } }, select: { id: true } },
        defaultManager: { select: { name: true } },
        defaultEditor: { select: { name: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    db.user.findMany({
      where: { isActive: true, role: { in: ["MANAGER", "ADMIN"] } },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { isActive: true, role: "EDITOR" },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clients"
        actions={
          <AddClientModal
            isAdmin={user.role === "ADMIN"}
            managers={managers}
            editors={editors}
          />
        }
      />

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
                  {user.role === "ADMIN" && <th className="py-2 pr-4 font-medium">Default manager</th>}
                  {(user.role === "ADMIN" || user.role === "MANAGER") && (
                    <th className="py-2 pr-4 font-medium">Default editor</th>
                  )}
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
                      <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">
                        <details>
                          <summary className="cursor-pointer select-none">
                            {c.defaultManager?.name ?? "—"}
                          </summary>
                          <ActionForm
                            action={clientSetDefaultManager}
                            submitLabel="Save"
                            className="mt-2 flex flex-col gap-2"
                            resetOnSuccess={false}
                            successMessage="Default manager updated"
                          >
                            <input type="hidden" name="clientId" value={c.id} />
                            <select name="defaultManagerId" defaultValue={c.defaultManagerId ?? ""} className={inputCls}>
                              <option value="">— none —</option>
                              {managers.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          </ActionForm>
                        </details>
                      </td>
                    )}
                    {(user.role === "ADMIN" || user.role === "MANAGER") && (
                      <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">
                        {user.role === "ADMIN" || c.defaultManagerId === user.id ? (
                          <details>
                            <summary className="cursor-pointer select-none">
                              {c.defaultEditor?.name ?? "—"}
                            </summary>
                            <ActionForm
                              action={clientSetDefaultEditor}
                              submitLabel="Save"
                              className="mt-2 flex flex-col gap-2"
                              resetOnSuccess={false}
                              successMessage="Default editor updated"
                            >
                              <input type="hidden" name="clientId" value={c.id} />
                              <select name="defaultEditorId" defaultValue={c.defaultEditorId ?? ""} className={inputCls}>
                                <option value="">— none —</option>
                                {editors.map((e) => (
                                  <option key={e.id} value={e.id}>{e.name}</option>
                                ))}
                              </select>
                            </ActionForm>
                          </details>
                        ) : (
                          c.defaultEditor?.name ?? "—"
                        )}
                      </td>
                    )}
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
    </div>
  );
}

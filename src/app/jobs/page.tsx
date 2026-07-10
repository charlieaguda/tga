import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { jobCreate } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";
import { JobStatusBadge } from "@/components/status-badge";
import { PageHeader, Section, EmptyState } from "@/components/ui";

const inputCls =
  "rounded-xl border border-slate-200/80 bg-white/50 px-3.5 py-2 text-sm backdrop-blur-sm shadow-sm transition-all focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800/80 dark:bg-slate-900/50 dark:focus:border-brand-500 dark:focus:bg-slate-950";

export default async function JobsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role === "CLIENT") redirect("/client-hub");

  // Editors see only jobs where they have assigned tasks; others see all.
  const jobs = await db.job.findMany({
    where: user.role === "EDITOR" ? { tasks: { some: { assigneeId: user.id } } } : {},
    include: {
      client: true,
      manager: true,
      tasks: { where: { status: { notIn: ["POSTED", "CANCELLED"] } }, select: { id: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });

  const canCreate = user.role === "ADMIN" || user.role === "MANAGER";
  const [clients, managers] =
    canCreate
      ? await Promise.all([
          db.client.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
          user.role === "ADMIN"
            ? db.user.findMany({
                where: { isActive: true, role: { in: ["MANAGER", "ADMIN"] } },
                orderBy: { name: "asc" },
              })
            : Promise.resolve([]),
        ])
      : [[], []];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Jobs" />

      <Section title={`All jobs (${jobs.length})`}>
        {jobs.length === 0 ? (
          <EmptyState>No jobs yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-4 font-medium">Job</th>
                  <th className="py-2 pr-4 font-medium">Client</th>
                  <th className="py-2 pr-4 font-medium">Manager</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 font-medium">Open tasks</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr
                    key={j.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <td className="py-2.5 pr-4">
                      <Link
                        href={`/jobs/${j.id}`}
                        className="font-medium text-slate-900 hover:text-brand-600 hover:underline dark:text-slate-100 dark:hover:text-brand-500"
                      >
                        {j.title}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{j.client.name}</td>
                    <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">{j.manager.name}</td>
                    <td className="py-2.5 pr-4">
                      <JobStatusBadge status={j.status} />
                    </td>
                    <td className="py-2.5 text-slate-600 dark:text-slate-300">{j.tasks.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {canCreate && (
        <Section title="New job">
          {clients.length === 0 ? (
            <EmptyState>
              Add a{" "}
              <Link className="font-medium text-brand-600 hover:underline dark:text-brand-500" href="/clients">
                client
              </Link>{" "}
              first.
            </EmptyState>
          ) : (
            <ActionForm action={jobCreate} submitLabel="Create job" className="flex max-w-md flex-col gap-2">
              <select name="clientId" required className={inputCls}>
                <option value="">Select client…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                name="title"
                required
                placeholder='Job title, e.g. "Instagram management 2026"'
                className={inputCls}
              />
              <textarea name="description" rows={2} placeholder="Description (optional)" className={inputCls} />
              {user.role === "ADMIN" && managers.length > 0 && (
                <select name="managerId" className={inputCls}>
                  <option value="">Owning manager (default: me)</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </ActionForm>
          )}
        </Section>
      )}
    </div>
  );
}

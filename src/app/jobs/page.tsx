import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { jobCreate } from "@/lib/actions";
import { ActionForm } from "@/components/action-form";
import { JobStatusBadge } from "@/components/status-badge";

export default async function JobsPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");

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
      <h1 className="text-xl font-semibold">Jobs</h1>

      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <th className="py-2 pr-4 font-medium">Job</th>
              <th className="py-2 pr-4 font-medium">Client</th>
              <th className="py-2 pr-4 font-medium">Manager</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 font-medium">Open tasks</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-b border-gray-100 last:border-0 dark:border-gray-800">
                <td className="py-2.5 pr-4">
                  <Link href={`/jobs/${j.id}`} className="font-medium hover:underline">
                    {j.title}
                  </Link>
                </td>
                <td className="py-2.5 pr-4">{j.client.name}</td>
                <td className="py-2.5 pr-4 text-gray-600 dark:text-gray-300">{j.manager.name}</td>
                <td className="py-2.5 pr-4">
                  <JobStatusBadge status={j.status} />
                </td>
                <td className="py-2.5">{j.tasks.length}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-gray-500">
                  No jobs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canCreate && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            New job
          </h2>
          {clients.length === 0 ? (
            <p className="text-sm text-gray-500">
              Add a <Link className="underline" href="/clients">client</Link> first.
            </p>
          ) : (
            <ActionForm action={jobCreate} submitLabel="Create job" className="flex max-w-md flex-col gap-2">
              <select
                name="clientId"
                required
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
              >
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
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
              <textarea
                name="description"
                rows={2}
                placeholder="Description (optional)"
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
              {user.role === "ADMIN" && managers.length > 0 && (
                <select
                  name="managerId"
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
                >
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
        </div>
      )}
    </div>
  );
}

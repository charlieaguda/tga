import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { listCategories } from "@/lib/services/categories";
import { describeActivity, ACTIVITY_ACTION_GROUPS } from "@/lib/activity-descriptions";
import { fmtDateTime } from "@/lib/format";
import { PageHeader, Section, EmptyState } from "@/components/ui";

const PAGE_SIZE = 50;

const selectCls =
  "rounded-xl border border-slate-200/80 bg-white/50 px-3 py-1.5 text-sm backdrop-blur-sm shadow-sm transition-all focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-800/80 dark:bg-slate-900/50 dark:focus:border-brand-500 dark:focus:bg-slate-950";

export default async function ActivityLogsPage(props: {
  searchParams: Promise<{ clientId?: string; jobId?: string; action?: string; cursor?: string }>;
}) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role === "CLIENT") redirect("/client-hub");

  const { clientId, jobId, action, cursor } = await props.searchParams;

  const where: Prisma.ActivityLogWhereInput = {
    ...(clientId && { clientId }),
    ...(jobId && { jobId }),
    ...(action && { action }),
  };
  const cursorId = cursor && /^\d+$/.test(cursor) ? BigInt(cursor) : undefined;

  const [rows, allClients, jobsForFilter, categories] = await Promise.all([
    db.activityLog.findMany({
      where,
      include: { actor: { select: { name: true } } },
      orderBy: { id: "desc" },
      take: PAGE_SIZE + 1,
      ...(cursorId !== undefined && { cursor: { id: cursorId }, skip: 1 }),
    }),
    db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    clientId
      ? db.job.findMany({ where: { clientId }, select: { id: true, title: true }, orderBy: { title: "asc" } })
      : Promise.resolve([]),
    listCategories(),
  ]);

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id.toString() : null;

  const clientIds = [...new Set(page.map((r) => r.clientId).filter((v): v is string => !!v))];
  const jobIds = [...new Set(page.map((r) => r.jobId).filter((v): v is string => !!v))];
  const [clientsById, jobsById] = await Promise.all([
    db.client
      .findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
      .then((rows) => new Map(rows.map((c) => [c.id, c.name]))),
    db.job
      .findMany({ where: { id: { in: jobIds } }, select: { id: true, title: true } })
      .then((rows) => new Map(rows.map((j) => [j.id, j.title]))),
  ]);

  const labelOf = new Map(categories.map((c) => [c.key, c.label]));
  const categoryLabel = (key: string) => labelOf.get(key) ?? key;

  const filterQS = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ clientId, jobId, action, ...extra })) {
      if (v) params.set(k, v);
    }
    return `?${params.toString()}`;
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Activity Logs" description="Every job, client, task, submission, user, and file transaction." />

      <Section title="Filters">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Client
            <select name="clientId" defaultValue={clientId ?? ""} className={selectCls}>
              <option value="">All clients</option>
              {allClients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Job
            <select name="jobId" defaultValue={jobId ?? ""} className={selectCls} disabled={!clientId}>
              <option value="">{clientId ? "All jobs" : "Pick a client first"}</option>
              {jobsForFilter.map((j) => (
                <option key={j.id} value={j.id}>{j.title}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            Action
            <select name="action" defaultValue={action ?? ""} className={selectCls}>
              <option value="">All actions</option>
              {ACTIVITY_ACTION_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.actions.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="cursor-pointer rounded-xl border border-slate-200/80 bg-white/50 px-3.5 py-1.5 text-sm font-medium text-slate-600 transition-all hover:bg-slate-100 dark:border-slate-800/80 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Filter
          </button>
          {(clientId || jobId || action) && (
            <Link
              href="/activity-logs"
              className="text-sm text-slate-500 hover:underline dark:text-slate-400"
            >
              Clear
            </Link>
          )}
        </form>
      </Section>

      <Section title={`Activity (${page.length}${hasMore ? "+" : ""})`}>
        {page.length === 0 ? (
          <EmptyState>No activity matches these filters.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Actor</th>
                  <th className="py-2 pr-4 font-medium">What</th>
                  <th className="py-2 pr-4 font-medium">Client</th>
                  <th className="py-2 font-medium">Job</th>
                </tr>
              </thead>
              <tbody>
                {page.map((row) => (
                  <tr
                    key={row.id.toString()}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <td className="py-2.5 pr-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                      {fmtDateTime(row.createdAt)}
                    </td>
                    <td className="py-2.5 pr-4 font-medium">{row.actor?.name ?? "System"}</td>
                    <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">
                      {describeActivity(row.action, row.meta, categoryLabel)}
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600 dark:text-slate-300">
                      {row.clientId ? clientsById.get(row.clientId) ?? "—" : "—"}
                    </td>
                    <td className="py-2.5 text-slate-600 dark:text-slate-300">
                      {row.jobId ? (
                        <Link href={`/jobs/${row.jobId}`} className="hover:text-brand-600 dark:hover:text-brand-500">
                          {jobsById.get(row.jobId) ?? row.jobId}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && nextCursor && (
          <div className="mt-4">
            <Link
              href={filterQS({ cursor: nextCursor })}
              className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-500"
            >
              Older →
            </Link>
          </div>
        )}
      </Section>
    </div>
  );
}

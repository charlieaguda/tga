import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma, TaskStatus } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { TaskTable } from "@/components/task-table";
import { TaskStatusBadge } from "@/components/status-badge";
import { isOverdue } from "@/lib/format";

const include = { job: { include: { client: true } }, assignee: true } satisfies Prisma.TaskInclude;
const OPEN: TaskStatus[] = ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatTile({ value, tone = "default" }: { value: number | string; tone?: "default" | "danger" }) {
  return <p className={`text-3xl font-bold ${tone === "danger" ? "text-red-600" : ""}`}>{value}</p>;
}

async function EditorDashboard(userId: string) {
  const [queue, changesRequested, recentlyPosted] = await Promise.all([
    db.task.findMany({
      where: { assigneeId: userId, status: { in: ["ASSIGNED", "IN_PROGRESS", "SUBMITTED"] } },
      include,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
    }),
    db.task.findMany({
      where: { assigneeId: userId, status: "CHANGES_REQUESTED" },
      include,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
    }),
    db.task.findMany({
      where: { assigneeId: userId, status: "POSTED" },
      include,
      orderBy: { postedAt: "desc" },
      take: 5,
    }),
  ]);
  const overdueCount = [...queue, ...changesRequested].filter(isOverdue).length;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">My queue</h1>
      {overdueCount > 0 && (
        <p className="text-sm font-semibold text-red-600">
          {overdueCount} of your tasks are overdue.
        </p>
      )}
      {changesRequested.length > 0 && (
        <Section title="Changes requested — action needed">
          <TaskTable tasks={changesRequested} empty="" />
        </Section>
      )}
      <Section title="My tasks">
        <TaskTable tasks={queue} empty="Nothing assigned right now." />
      </Section>
      <Section title="Recently posted">
        <TaskTable tasks={recentlyPosted} empty="Nothing posted yet — get one over the line!" />
      </Section>
    </div>
  );
}

async function ManagerDashboard(userId: string) {
  const [awaitingReview, toPost, myOpen, drafts, recentlyPosted] = await Promise.all([
    db.task.findMany({
      where: { job: { managerId: userId }, status: "SUBMITTED" },
      include,
      orderBy: { updatedAt: "asc" },
    }),
    db.task.findMany({
      where: { job: { managerId: userId }, status: "APPROVED" },
      include,
      orderBy: { updatedAt: "asc" },
    }),
    db.task.findMany({
      where: { job: { managerId: userId }, status: { in: OPEN } },
      include,
      orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }],
    }),
    db.task.findMany({
      where: { job: { managerId: userId }, status: "DRAFT" },
      include,
      orderBy: { createdAt: "asc" },
    }),
    db.task.findMany({
      where: { job: { managerId: userId }, status: "POSTED" },
      include,
      orderBy: { postedAt: "desc" },
      take: 8,
    }),
  ]);

  const workload = new Map<string, number>();
  for (const t of myOpen) {
    const name = t.assignee?.name ?? "Unassigned";
    workload.set(name, (workload.get(name) ?? 0) + 1);
  }
  const workloadEntries = [...workload.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">My clients</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Section title="Overdue (mine)">
          <StatTile value={myOpen.filter(isOverdue).length} tone={myOpen.filter(isOverdue).length ? "danger" : "default"} />
        </Section>
        <Section title="Needs an editor">
          <StatTile value={drafts.length} />
        </Section>
      </div>
      <Section title={`Awaiting my review (${awaitingReview.length})`}>
        <TaskTable tasks={awaitingReview} empty="Nothing waiting on you. Nice." />
      </Section>
      <Section title={`Approved — ready to post (${toPost.length})`}>
        <TaskTable tasks={toPost} empty="Nothing ready to post." />
      </Section>
      <Section title={`Needs an editor (${drafts.length})`}>
        <TaskTable tasks={drafts} empty="Nothing waiting to be assigned." />
      </Section>
      <Section title="All my open tasks">
        <TaskTable tasks={myOpen} empty="No open tasks in your jobs." />
      </Section>
      <Section title="Editor workload">
        <div className="flex flex-col gap-2">
          {workloadEntries.map(([name, count]) => (
            <div key={name} className="flex items-center gap-2">
              <span className="w-40 truncate font-medium">{name}</span>
              <span className="text-sm">×{count}</span>
            </div>
          ))}
          {workloadEntries.length === 0 && <p className="text-sm text-gray-500">No open tasks in your jobs.</p>}
        </div>
      </Section>
      <Section title="Recently posted">
        <TaskTable tasks={recentlyPosted} empty="Nothing posted yet." />
      </Section>
    </div>
  );
}

async function CompanyDashboard() {
  const [byClient, overdue, draftsCount, highFrictionCount, editorWorkload, recentlyPosted] = await Promise.all([
    db.client.findMany({
      where: { isActive: true },
      include: {
        jobs: {
          where: { status: { not: "ARCHIVED" } },
          include: { tasks: { where: { status: { in: OPEN } }, select: { status: true } } },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.task.findMany({
      where: { status: { in: OPEN }, dueAt: { lt: new Date() } },
      include,
      orderBy: { dueAt: "asc" },
    }),
    db.task.count({ where: { status: "DRAFT" } }),
    db.task.count({ where: { status: { in: OPEN }, submissions: { some: { round: { gte: 2 } } } } }),
    db.user.findMany({
      where: { role: "EDITOR", isActive: true },
      include: { assignedTasks: { where: { status: { in: OPEN } }, select: { status: true, dueAt: true } } },
      orderBy: { name: "asc" },
    }),
    db.task.findMany({
      where: { status: "POSTED" },
      include,
      orderBy: { postedAt: "desc" },
      take: 10,
    }),
  ]);

  const statuses: TaskStatus[] = ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"];
  const editorWorkloadSorted = editorWorkload
    .map((e) => ({
      name: e.name,
      openCount: e.assignedTasks.length,
      overdueCount: e.assignedTasks.filter(isOverdue).length,
    }))
    .sort((a, b) => b.openCount - a.openCount);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Company overview</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Section title="Overdue tasks">
          <StatTile value={overdue.length} tone={overdue.length ? "danger" : "default"} />
        </Section>
        <Section title="Active clients">
          <StatTile value={byClient.length} />
        </Section>
        <Section title="Needs an editor">
          <StatTile value={draftsCount} />
        </Section>
        <Section title="In 2+ revision rounds">
          <StatTile value={highFrictionCount} />
        </Section>
      </div>
      <Section title="Pipeline by client">
        <div className="flex flex-col gap-3">
          {byClient.map((c) => {
            const tasks = c.jobs.flatMap((j) => j.tasks);
            const counts = statuses
              .map((s) => ({ s, n: tasks.filter((t) => t.status === s).length }))
              .filter((x) => x.n > 0);
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-2">
                <span className="w-40 truncate font-medium">{c.name}</span>
                {counts.length === 0 ? (
                  <span className="text-sm text-amber-600">empty pipeline</span>
                ) : (
                  counts.map(({ s, n }) => (
                    <span key={s} className="flex items-center gap-1 text-sm">
                      <TaskStatusBadge status={s} /> ×{n}
                    </span>
                  ))
                )}
              </div>
            );
          })}
          {byClient.length === 0 && (
            <p className="text-sm text-gray-500">
              No clients yet. <Link className="underline" href="/clients">Add one</Link>.
            </p>
          )}
        </div>
      </Section>
      <Section title="Editor workload">
        <div className="flex flex-col gap-2">
          {editorWorkloadSorted.map((e) => (
            <div key={e.name} className="flex items-center gap-2">
              <span className="w-40 truncate font-medium">{e.name}</span>
              <span className="text-sm">×{e.openCount} open</span>
              {e.overdueCount > 0 && (
                <span className="text-sm text-red-600">{e.overdueCount} overdue</span>
              )}
            </div>
          ))}
          {editorWorkloadSorted.length === 0 && (
            <p className="text-sm text-gray-500">No active editors.</p>
          )}
        </div>
      </Section>
      {overdue.length > 0 && (
        <Section title="Overdue list">
          <TaskTable tasks={overdue} empty="" />
        </Section>
      )}
      <Section title="Recently posted">
        <TaskTable tasks={recentlyPosted} empty="Nothing posted yet." />
      </Section>
    </div>
  );
}

export default async function DashboardPage() {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");

  if (user.role === "EDITOR") return EditorDashboard(user.id);
  if (user.role === "MANAGER") return ManagerDashboard(user.id);
  if (user.role === "CLIENT") redirect("/client-hub");
  return CompanyDashboard(); // ADMIN + CEO + VIEWER
}

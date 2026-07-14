import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma, TaskStatus } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { TaskTable } from "@/components/task-table";
import { TaskStatusBadge } from "@/components/status-badge";
import { isOverdue } from "@/lib/format";
import { PageHeader, Section, StatTile, EmptyState } from "@/components/ui";
import { ClientHubAccordion } from "@/components/client-hub-accordion";
import { listCategories } from "@/lib/services/categories";
import { isDriveConfigured } from "@/lib/drive";
import { buildFileActivityDaysMap } from "@/lib/file-activity-calendar";

const include = { job: { include: { client: true } }, assignee: true } satisfies Prisma.TaskInclude;
const OPEN: TaskStatus[] = ["ASSIGNED", "IN_PROGRESS", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED"];

function WorkloadBar({ name, count, max, overdue }: { name: string; count: number; max: number; overdue?: number }) {
  const pct = max > 0 ? Math.max(8, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 truncate text-sm font-medium text-slate-700 dark:text-slate-300">{name}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-sm tabular-nums text-slate-500 dark:text-slate-400">
        {count}
      </span>
      {!!overdue && <span className="shrink-0 text-xs font-medium text-red-600 dark:text-red-400">{overdue} late</span>}
    </div>
  );
}

async function EditorDashboard(userId: string) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const [queue, changesRequested, recentlyPosted, clients, categories, driveConfigured] = await Promise.all([
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
    db.client.findMany({
      where: {
        isActive: true,
        jobs: {
          some: {
            tasks: {
              some: {
                assigneeId: userId,
              },
            },
          },
        },
      },
      include: {
        files: {
          where: { category: { not: null } },
          orderBy: { createdAt: "desc" },
        },
        jobs: {
          where: { tasks: { some: { assigneeId: userId } } },
          include: {
            tasks: {
              where: { assigneeId: userId },
              orderBy: { updatedAt: "desc" },
              select: { id: true, title: true, status: true, createdAt: true, dueAt: true },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    listCategories(),
    isDriveConfigured(),
  ]);

  const clientIds = clients.map((c) => c.id);
  const activity = await db.activityLog.findMany({
    where: {
      clientId: { in: clientIds },
      action: "file.uploaded",
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    select: { id: true, clientId: true, action: true, meta: true, createdAt: true, actor: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const clientsWithActivity = clients.map((c) => {
    const clientActivity = activity.filter((a) => a.clientId === c.id);
    const fileActivityDays = buildFileActivityDaysMap(clientActivity, categories);
    return {
      ...c,
      activeDays: Object.keys(fileActivityDays),
      fileActivityDays,
    };
  });

  const overdueCount = [...queue, ...changesRequested].filter(isOverdue).length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="My queue" />
      {overdueCount > 0 && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          {overdueCount} of your tasks are overdue.
        </div>
      )}
      <Section title="Client Hub">
        <ClientHubAccordion
          clients={clientsWithActivity}
          year={year}
          month={month}
          canEdit={true}
          categories={categories}
          driveConfigured={driveConfigured}
        />
      </Section>
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
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const [awaitingReview, toPost, myOpen, drafts, recentlyPosted, clients, categories, driveConfigured] = await Promise.all([
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
    db.client.findMany({
      where: {
        isActive: true,
        OR: [{ jobs: { some: { managerId: userId } } }, { defaultManagerId: userId }],
      },
      include: {
        files: {
          where: { category: { not: null } },
          orderBy: { createdAt: "desc" },
        },
        jobs: {
          where: { managerId: userId },
          include: {
            tasks: {
              orderBy: { updatedAt: "desc" },
              select: {
                id: true,
                title: true,
                status: true,
                createdAt: true,
                dueAt: true,
                assignee: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    listCategories(),
    isDriveConfigured(),
  ]);

  const clientIds = clients.map((c) => c.id);
  const activity = await db.activityLog.findMany({
    where: {
      clientId: { in: clientIds },
      action: "file.uploaded",
      createdAt: { gte: monthStart, lt: monthEnd },
    },
    select: { id: true, clientId: true, action: true, meta: true, createdAt: true, actor: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const clientsWithActivity = clients.map((c) => {
    const clientActivity = activity.filter((a) => a.clientId === c.id);
    const fileActivityDays = buildFileActivityDaysMap(clientActivity, categories);
    return {
      ...c,
      activeDays: Object.keys(fileActivityDays),
      fileActivityDays,
    };
  });

  const workload = new Map<string, number>();
  for (const t of myOpen) {
    const name = t.assignee?.name ?? "Unassigned";
    workload.set(name, (workload.get(name) ?? 0) + 1);
  }
  const workloadEntries = [...workload.entries()].sort((a, b) => b[1] - a[1]);

  const maxWorkload = Math.max(1, ...workloadEntries.map(([, n]) => n));
  const myOverdueCount = myOpen.filter(isOverdue).length;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="My clients" />
      <Section title="Client Hub">
        <ClientHubAccordion
          clients={clientsWithActivity}
          year={year}
          month={month}
          canEdit={true}
          categories={categories}
          driveConfigured={driveConfigured}
        />
      </Section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Section title="Overdue (mine)">
          <StatTile value={myOverdueCount} tone={myOverdueCount ? "danger" : "default"} />
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
        <div className="flex flex-col gap-3">
          {workloadEntries.map(([name, count]) => (
            <WorkloadBar key={name} name={name} count={count} max={maxWorkload} />
          ))}
          {workloadEntries.length === 0 && <EmptyState>No open tasks in your jobs.</EmptyState>}
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

  const maxEditorWorkload = Math.max(1, ...editorWorkloadSorted.map((e) => e.openCount));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Company overview" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Section title="Overdue tasks">
          <StatTile value={overdue.length} tone={overdue.length ? "danger" : "default"} />
        </Section>
        <Section title="Active clients">
          <StatTile value={byClient.length} tone="brand" />
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
              <div key={c.id} className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0 dark:border-slate-800">
                <span className="w-40 shrink-0 truncate font-medium text-slate-700 dark:text-slate-300">{c.name}</span>
                {counts.length === 0 ? (
                  <span className="text-sm text-amber-600 dark:text-amber-400">empty pipeline</span>
                ) : (
                  counts.map(({ s, n }) => (
                    <span key={s} className="flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400">
                      <TaskStatusBadge status={s} /> ×{n}
                    </span>
                  ))
                )}
              </div>
            );
          })}
          {byClient.length === 0 && (
            <EmptyState>
              No clients yet. <Link className="font-medium text-brand-600 hover:underline dark:text-brand-500" href="/clients">Add one</Link>.
            </EmptyState>
          )}
        </div>
      </Section>
      <Section title="Editor workload">
        <div className="flex flex-col gap-3">
          {editorWorkloadSorted.map((e) => (
            <WorkloadBar key={e.name} name={e.name} count={e.openCount} max={maxEditorWorkload} overdue={e.overdueCount} />
          ))}
          {editorWorkloadSorted.length === 0 && <EmptyState>No active editors.</EmptyState>}
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

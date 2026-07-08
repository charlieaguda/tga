import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { adminReassignJob, jobSetStatus, taskCreate } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { JobStatusBadge } from "@/components/status-badge";
import { TaskTable } from "@/components/task-table";

export default async function JobPage(props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");

  const { id } = await props.params;
  const job = await db.job.findUnique({
    where: { id },
    include: {
      client: true,
      manager: true,
      tasks: {
        include: { job: { include: { client: true } }, assignee: true },
        orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }],
      },
    },
  });
  if (!job) notFound();

  // Editors may only view jobs they work on.
  if (user.role === "EDITOR" && !job.tasks.some((t) => t.assigneeId === user.id)) {
    redirect("/dashboard");
  }
  const tasks =
    user.role === "EDITOR" ? job.tasks.filter((t) => t.assigneeId === user.id) : job.tasks;

  const manages = user.role === "ADMIN" || (user.role === "MANAGER" && job.managerId === user.id);
  const canCreateTask = manages || user.role === "CEO";

  const editors = canCreateTask
    ? await db.user.findMany({
        where: { isActive: true, role: "EDITOR" },
        orderBy: { name: "asc" },
      })
    : [];
  const managers =
    user.role === "ADMIN"
      ? await db.user.findMany({
          where: { isActive: true, role: { in: ["MANAGER", "ADMIN"] } },
          orderBy: { name: "asc" },
        })
      : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{job.title}</h1>
        <JobStatusBadge status={job.status} />
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {job.client.name} · managed by {job.manager.name}
        </span>
        {manages && (
          <span className="ml-auto flex gap-2">
            {job.status === "ACTIVE" && (
              <ActionButton
                action={jobSetStatus.bind(null, job.id, "PAUSED")}
                label="Pause"
                variant="neutral"
              />
            )}
            {job.status === "PAUSED" && (
              <ActionButton
                action={jobSetStatus.bind(null, job.id, "ACTIVE")}
                label="Resume"
                variant="neutral"
              />
            )}
            {job.status !== "ARCHIVED" && (
              <ActionButton
                action={jobSetStatus.bind(null, job.id, "ARCHIVED")}
                label="Archive"
                variant="danger"
                confirm="Archive this job? All tasks must already be closed."
              />
            )}
          </span>
        )}
      </div>

      {job.description && (
        <p className="whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">
          {job.description}
        </p>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Tasks
        </h2>
        <TaskTable tasks={tasks} empty="No tasks in this job yet." />
      </section>

      {canCreateTask && job.status === "ACTIVE" && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            New task
          </h2>
          <ActionForm action={taskCreate} submitLabel="Create task" className="flex max-w-lg flex-col gap-2">
            <input type="hidden" name="jobId" value={job.id} />
            <input
              name="title"
              required
              placeholder='Task title, e.g. "July Reel #3"'
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
            <textarea
              name="brief"
              rows={5}
              placeholder="Brief / guide for the editor: what to edit, style, length, captions…"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
            <input
              name="referenceLink"
              placeholder="Reference link (optional, https://…)"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            />
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Due date
              <input
                type="date"
                name="dueAt"
                className="ml-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
              />
            </label>
            <select
              name="assigneeId"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            >
              <option value="">Editor (assign later)</option>
              {editors.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400">
              Task is created as a draft — assign it from the task page to notify the editor.
            </p>
          </ActionForm>
        </section>
      )}

      {user.role === "ADMIN" && managers.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Reassign job manager
          </h2>
          <ActionForm action={adminReassignJob} submitLabel="Reassign" className="flex max-w-md flex-col gap-2">
            <input type="hidden" name="jobId" value={job.id} />
            <select
              name="managerId"
              required
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800"
            >
              <option value="">New manager…</option>
              {managers
                .filter((m) => m.id !== job.managerId)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </ActionForm>
        </section>
      )}
    </div>
  );
}

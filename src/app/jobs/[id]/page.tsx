import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { adminReassignJob, jobSetDefaultEditor, jobSetStatus, taskCreate } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { JobStatusBadge } from "@/components/status-badge";
import { TaskTable } from "@/components/task-table";
import { Section } from "@/components/ui";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800";

export default async function JobPage(props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role === "CLIENT") redirect("/client-hub");

  const { id } = await props.params;
  const job = await db.job.findUnique({
    where: { id },
    include: {
      client: true,
      manager: true,
      defaultEditor: true,
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
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {job.title}
        </h1>
        <JobStatusBadge status={job.status} />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {job.client.name} · managed by {job.manager.name}
          {job.defaultEditor && <> · default editor {job.defaultEditor.name}</>}
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
        <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
          {job.description}
        </p>
      )}

      <Section title="Tasks">
        <TaskTable tasks={tasks} empty="No tasks in this job yet." />
      </Section>

      {manages && editors.length > 0 && (
        <Section title="Default editor for this job">
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            Pre-fills the editor when creating new tasks under this job — each task can still be
            reassigned individually.
          </p>
          <ActionForm
            action={jobSetDefaultEditor}
            submitLabel="Save"
            className="flex max-w-md flex-col gap-2"
            resetOnSuccess={false}
          >
            <input type="hidden" name="jobId" value={job.id} />
            <select name="editorId" defaultValue={job.defaultEditorId ?? ""} className={inputCls}>
              <option value="">No default editor</option>
              {editors.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </ActionForm>
        </Section>
      )}

      {canCreateTask && job.status === "ACTIVE" && (
        <Section title="New task">
          <ActionForm action={taskCreate} submitLabel="Create task" className="flex max-w-lg flex-col gap-2">
            <input type="hidden" name="jobId" value={job.id} />
            <input
              name="title"
              required
              placeholder='Task title, e.g. "July Reel #3"'
              className={inputCls}
            />
            <textarea
              name="brief"
              rows={5}
              placeholder="Brief / guide for the editor: what to edit, style, length, captions…"
              className={inputCls}
            />
            <input
              name="referenceLink"
              placeholder="Reference link (optional, https://…)"
              className={inputCls}
            />
            <label className="text-xs text-slate-500 dark:text-slate-400">
              Due date
              <input type="date" name="dueAt" className={`ml-2 ${inputCls}`} />
            </label>
            <select name="assigneeId" defaultValue={job.defaultEditorId ?? ""} className={inputCls}>
              <option value="">Editor (assign later)</option>
              {editors.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.id === job.defaultEditorId ? " (default)" : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Task is created as a draft — assign it from the task page to notify the editor.
            </p>
          </ActionForm>
        </Section>
      )}

      {user.role === "ADMIN" && managers.length > 0 && (
        <Section title="Reassign job manager">
          <ActionForm action={adminReassignJob} submitLabel="Reassign" className="flex max-w-md flex-col gap-2">
            <input type="hidden" name="jobId" value={job.id} />
            <select name="managerId" required className={inputCls}>
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
        </Section>
      )}
    </div>
  );
}

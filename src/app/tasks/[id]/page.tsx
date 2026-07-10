import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { allowedTransitions } from "@/lib/transitions";
import {
  commentAdd,
  taskAssign,
  taskCancel,
  taskMarkPosted,
  taskReview,
  taskStart,
  taskStartRevision,
  taskSubmit,
} from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { TaskStatusBadge } from "@/components/status-badge";
import { Uploader } from "@/components/uploader";
import { TaskAttachmentUploader } from "@/components/file-drop-uploader";
import { driveViewLink, isDriveConfigured } from "@/lib/drive";
import { fmtDate, fmtDateTime, isOverdue } from "@/lib/format";

const inputCls =
  "rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function TaskPage(props: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");
  if (user.role === "CLIENT") redirect("/client-hub");

  const { id } = await props.params;
  const task = await db.task.findUnique({
    where: { id },
    include: {
      job: { include: { client: true, manager: true } },
      assignee: true,
      createdBy: true,
      attachments: true,
      submissions: {
        orderBy: { round: "asc" },
        include: { files: true, review: { include: { reviewer: true } } },
      },
      comments: { orderBy: { createdAt: "asc" }, include: { author: true } },
    },
  });
  if (!task) notFound();

  // Server-side read scoping: editors only see their own tasks.
  if (user.role === "EDITOR" && task.assigneeId !== user.id) redirect("/dashboard");

  const me = { id: user.id, role: user.role, name: user.name, email: user.email };
  const allowed = allowedTransitions(me, task);
  const isAssignee = task.assigneeId === user.id;
  const openSubmission = task.submissions.find((s) => s.submittedAt === null);
  const canAssign =
    (user.role === "ADMIN" || user.role === "CEO" ||
      (user.role === "MANAGER" && task.job.managerId === user.id)) &&
    !["APPROVED", "POSTED", "CANCELLED"].includes(task.status);
  const canAttach =
    (user.role === "ADMIN" || user.role === "CEO" ||
      (user.role === "MANAGER" && task.job.managerId === user.id)) &&
    !["POSTED", "CANCELLED"].includes(task.status);

  const editors = canAssign
    ? await db.user.findMany({ where: { isActive: true, role: "EDITOR" }, orderBy: { name: "asc" } })
    : [];

  // Merged timeline: comments + status changes, oldest first.
  const activity = await db.activityLog.findMany({
    where: { taskId: task.id, action: { not: "comment.added" } },
    orderBy: { createdAt: "asc" },
    include: { actor: true },
  });
  const timeline = [
    ...task.comments.map((c) => ({
      key: `c-${c.id}`,
      at: c.createdAt,
      who: c.author.name,
      kind: "comment" as const,
      text: c.body,
    })),
    ...activity.map((a) => ({
      key: `a-${a.id}`,
      at: a.createdAt,
      who: a.actor?.name ?? "System",
      kind: "event" as const,
      text: describeActivity(a.action, a.meta as Record<string, unknown> | null),
    })),
  ].sort((x, y) => x.at.getTime() - y.at.getTime());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{task.title}</h1>
        <TaskStatusBadge status={task.status} />
        {isOverdue(task) && <span className="text-sm font-semibold text-red-600">Overdue</span>}
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {task.job.client.name} ·{" "}
        <Link href={`/jobs/${task.job.id}`} className="hover:underline">
          {task.job.title}
        </Link>{" "}
        · manager {task.job.manager.name} · editor {task.assignee?.name ?? "unassigned"} · due{" "}
        {fmtDate(task.dueAt)}
        {task.postUrl && (
          <>
            {" · "}
            <a href={task.postUrl} className="text-blue-600 hover:underline" rel="noreferrer noopener" target="_blank">
              live post
            </a>
          </>
        )}
      </p>

      {/* ---------- Actions ---------- */}
      <div className="flex flex-wrap items-start gap-3">
        {allowed.includes("IN_PROGRESS") && task.status === "ASSIGNED" && isAssignee && (
          <ActionButton action={taskStart.bind(null, task.id)} label="Start task" />
        )}
        {allowed.includes("IN_PROGRESS") && task.status === "CHANGES_REQUESTED" && isAssignee && (
          <ActionButton action={taskStartRevision.bind(null, task.id)} label="Start revision" />
        )}
        {allowed.includes("CANCELLED") && (
          <details className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-600">
            <summary className="cursor-pointer select-none text-red-600">Cancel task…</summary>
            <ActionForm action={taskCancel} submitLabel="Confirm cancel" className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="taskId" value={task.id} />
              <input name="reason" required placeholder="Reason (required)" className={inputCls} />
            </ActionForm>
          </details>
        )}
      </div>

      {/* ---------- Brief ---------- */}
      <Card title="Brief">
        {/* Plain text rendering — user content is never injected as HTML */}
        <p className="whitespace-pre-wrap text-sm">{task.brief || "No brief yet."}</p>
        {task.referenceLink && (
          <p className="mt-2 text-sm">
            Reference:{" "}
            <a
              href={task.referenceLink}
              className="text-blue-600 hover:underline"
              rel="noreferrer noopener"
              target="_blank"
            >
              {task.referenceLink}
            </a>
          </p>
        )}
        {task.attachments.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-sm">
            {task.attachments.map((f) => (
              <li key={f.id}>{f.fileName}</li>
            ))}
          </ul>
        )}
        {canAttach && isDriveConfigured() && (
          <div className="mt-3">
            <TaskAttachmentUploader taskId={task.id} />
          </div>
        )}
      </Card>

      {/* ---------- Assign ---------- */}
      {canAssign && editors.length > 0 && (
        <Card title={task.status === "DRAFT" ? "Assign editor" : "Reassign editor"}>
          <ActionForm
            action={taskAssign}
            submitLabel={task.status === "DRAFT" ? "Assign" : "Reassign"}
            className="flex max-w-md flex-col gap-2"
            resetOnSuccess={false}
          >
            <input type="hidden" name="taskId" value={task.id} />
            <select name="assigneeId" required defaultValue={task.assigneeId ?? ""} className={inputCls}>
              <option value="">Select editor…</option>
              {editors.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <label className="text-xs text-gray-500 dark:text-gray-400">
              Due date
              <input type="date" name="dueAt" className={`ml-2 ${inputCls}`} />
            </label>
          </ActionForm>
        </Card>
      )}

      {/* ---------- Deliverables by round ---------- */}
      <Card title="Deliverables">
        {task.submissions.length === 0 ? (
          <p className="text-sm text-gray-500">No rounds yet — the editor starts the task to open round 1.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {task.submissions.map((s) => (
              <div key={s.id} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">Round {s.round}</span>
                  {s.submittedAt ? (
                    <span className="text-gray-500">submitted {fmtDateTime(s.submittedAt)}</span>
                  ) : (
                    <span className="text-amber-600">open — not yet submitted</span>
                  )}
                  {s.review && (
                    <span
                      className={
                        s.review.decision === "APPROVED" ? "text-emerald-600" : "text-orange-600"
                      }
                    >
                      {s.review.decision === "APPROVED" ? "✓ approved" : "changes requested"} by{" "}
                      {s.review.reviewer.name}
                    </span>
                  )}
                </div>
                {s.note && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">{s.note}</p>}
                {s.review?.comment && (
                  <p className="mt-1 whitespace-pre-wrap rounded bg-orange-50 p-2 text-sm dark:bg-orange-950">
                    {s.review.comment}
                  </p>
                )}
                {s.files.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-400">No files in this round.</p>
                ) : (
                  <ul className="mt-2 flex flex-col gap-1 text-sm">
                    {s.files.map((f) => (
                      <li key={f.id} className="flex items-center gap-2">
                        <a
                          href={driveViewLink(f.driveFileId)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-blue-600 hover:underline"
                        >
                          📄 {f.storedName}
                        </a>
                        <span className="text-xs text-gray-400">
                          {(Number(f.sizeBytes) / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Editor: upload + submit controls on the open round */}
        {isAssignee && task.status === "IN_PROGRESS" && (
          <div className="mt-4 flex flex-col gap-3">
            {isDriveConfigured() ? (
              <Uploader taskId={task.id} initialFileCount={openSubmission?.files.length ?? 0} />
            ) : (
              <>
                <p className="text-sm text-amber-600">
                  Google Drive isn&apos;t configured yet (GOOGLE_SA_KEY_JSON /
                  DRIVE_SHARED_DRIVE_ID) — uploads are disabled.
                </p>
                <ActionForm action={taskSubmit} submitLabel="Submit for review" className="flex max-w-md flex-col gap-2">
                  <input type="hidden" name="taskId" value={task.id} />
                  <textarea
                    name="note"
                    rows={2}
                    placeholder="What changed this round? (optional)"
                    className={inputCls}
                  />
                </ActionForm>
              </>
            )}
          </div>
        )}

        {/* Manager: review controls */}
        {task.status === "SUBMITTED" && allowed.includes("APPROVED") && (
          <div className="mt-4 flex flex-col gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <ActionForm action={taskReview} submitLabel="Approve" className="flex max-w-md flex-col gap-2">
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="decision" value="APPROVED" />
            </ActionForm>
            <ActionForm action={taskReview} submitLabel="Request changes" className="flex max-w-md flex-col gap-2">
              <input type="hidden" name="taskId" value={task.id} />
              <input type="hidden" name="decision" value="CHANGES_REQUESTED" />
              <textarea
                name="comment"
                rows={3}
                required
                placeholder="Feedback for the editor (required)"
                className={inputCls}
              />
            </ActionForm>
          </div>
        )}

        {/* Manager: mark posted */}
        {task.status === "APPROVED" && allowed.includes("POSTED") && (
          <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
            <ActionForm action={taskMarkPosted} submitLabel="Mark as posted" className="flex max-w-md flex-col gap-2">
              <input type="hidden" name="taskId" value={task.id} />
              <input name="postUrl" placeholder="Live post URL (optional, https://…)" className={inputCls} />
            </ActionForm>
          </div>
        )}
      </Card>

      {/* ---------- Timeline ---------- */}
      <Card title="Activity & comments">
        <ul className="flex flex-col gap-3">
          {timeline.map((item) => (
            <li key={item.key} className="text-sm">
              <span className="text-xs text-gray-400">{fmtDateTime(item.at)}</span>{" "}
              <span className="font-medium">{item.who}</span>{" "}
              {item.kind === "comment" ? (
                <span className="mt-0.5 block whitespace-pre-wrap rounded-md bg-gray-50 p-2 dark:bg-gray-800">
                  {item.text}
                </span>
              ) : (
                <span className="text-gray-600 dark:text-gray-300">{item.text}</span>
              )}
            </li>
          ))}
          {timeline.length === 0 && <li className="text-sm text-gray-500">Nothing yet.</li>}
        </ul>
        <div className="mt-4 border-t border-gray-200 pt-4 dark:border-gray-700">
          <ActionForm action={commentAdd} submitLabel="Comment" className="flex flex-col gap-2">
            <input type="hidden" name="taskId" value={task.id} />
            <textarea name="body" rows={2} required placeholder="Write a comment…" className={inputCls} />
          </ActionForm>
        </div>
      </Card>
    </div>
  );
}

function describeActivity(action: string, meta: Record<string, unknown> | null): string {
  switch (action) {
    case "task.created":
      return "created the task";
    case "task.updated":
      return "edited the brief";
    case "task.status_changed":
      return `moved the task from ${String(meta?.from ?? "?").toLowerCase().replaceAll("_", " ")} to ${String(meta?.to ?? "?").toLowerCase().replaceAll("_", " ")}`;
    case "task.reassigned":
      return "reassigned the task";
    case "submission.round_opened":
      return `opened round ${meta?.round ?? "?"}`;
    case "review.approved":
      return `approved round ${meta?.round ?? "?"}`;
    case "review.changes_requested":
      return `requested changes on round ${meta?.round ?? "?"}`;
    case "file.uploaded":
      return "uploaded a file";
    default:
      return action;
  }
}

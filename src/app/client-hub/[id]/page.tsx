import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { clientOffboard, clientSetNotionUrl } from "@/lib/actions";
import { listCategories } from "@/lib/services/categories";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { AddCategoryButton } from "@/components/add-category-button";
import { CategoryFilesButton } from "@/components/category-files-button";
import { MonthCalendar } from "@/components/month-calendar";
import { isDriveConfigured } from "@/lib/drive";
import { fmtDate } from "@/lib/format";
import { buildTaskDaysMap } from "@/lib/task-calendar";
import { buildFileActivityDaysMap, type FileActivityDaysMap } from "@/lib/file-activity-calendar";
import { Section } from "@/components/ui";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800";

export default async function ClientHubDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");

  const canEdit = user.role === "ADMIN" || user.role === "MANAGER" || user.role === "EDITOR";

  const { id } = await props.params;
  if (user.role === "CLIENT" && user.clientId !== id) {
    redirect(user.clientId ? `/client-hub/${user.clientId}` : "/dashboard");
  }
  if (user.role === "EDITOR") {
    // Read-only reference access, scoped to clients they actually have an assigned task with.
    const hasTask = await db.task.count({ where: { assigneeId: user.id, job: { clientId: id } } });
    if (hasTask === 0) redirect("/dashboard");
  }

  const client = await db.client.findUnique({ where: { id } });
  if (!client) notFound();

  const canManage = user.role === "ADMIN" || user.role === "CEO" || user.role === "MANAGER";
  const canUploadCategory = (category: { clientWritable: boolean }) =>
    !client.offboardedAt &&
    (canManage || user.role === "EDITOR" || (user.role === "CLIENT" && category.clientWritable));

  const categories = await listCategories();
  const files = await db.file.findMany({
    where: { clientId: id, category: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  const filesByCategory = new Map<string, typeof files>();
  for (const category of categories) {
    filesByCategory.set(
      category.key,
      files.filter((f) => f.category === category.key),
    );
  }

  const { searchParams } = props;
  const monthParam = (await searchParams).month;
  const now = new Date();
  const [year, month] = monthParam?.match(/^\d{4}-\d{2}$/)
    ? monthParam.split("-").map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const isStaff = user.role !== "CLIENT";
  let activeDays: Set<string>;
  let fileActivityDays: FileActivityDaysMap | undefined;
  let taskDays: ReturnType<typeof buildTaskDaysMap> | undefined;

  if (isStaff) {
    const activity = await db.activityLog.findMany({
      where: { clientId: id, action: "file.uploaded", createdAt: { gte: monthStart, lt: monthEnd } },
      select: { entityId: true, createdAt: true, actor: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    });
    const [uploadedFiles, categoryFolders] = await Promise.all([
      db.file.findMany({
        where: { id: { in: activity.map((a) => a.entityId) } },
        select: { id: true, category: true, storedName: true, markedUsed: true },
      }),
      db.clientCategoryFolder.findMany({ where: { clientId: id }, select: { category: true, driveFolderId: true } }),
    ]);
    const filesById = new Map(uploadedFiles.map((f) => [f.id, f]));
    const folderIdByCategory = new Map(categoryFolders.map((c) => [c.category, c.driveFolderId]));
    fileActivityDays = buildFileActivityDaysMap(activity, categories, filesById, folderIdByCategory);
    activeDays = new Set(Object.keys(fileActivityDays));

    const monthTasks = await db.task.findMany({
      where: {
        job: { clientId: id },
        ...(user.role === "EDITOR" ? { assigneeId: user.id } : {}),
        OR: [
          { createdAt: { gte: monthStart, lt: monthEnd } },
          { dueAt: { gte: monthStart, lt: monthEnd } },
        ],
      },
      select: { id: true, title: true, status: true, createdAt: true, dueAt: true },
    });
    taskDays = buildTaskDaysMap(monthTasks);
  } else {
    const uploads = await db.activityLog.findMany({
      where: { clientId: id, action: "file.uploaded", createdAt: { gte: monthStart, lt: monthEnd } },
      select: { createdAt: true },
    });
    activeDays = new Set(uploads.map((u) => u.createdAt.toISOString().slice(0, 10)));
  }

  const driveConfigured = await isDriveConfigured();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {client.name}
        </h1>
        {client.offboardedAt && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            Offboarded {fmtDate(client.offboardedAt)}
          </span>
        )}
        {user.role === "ADMIN" && !client.offboardedAt && (
          <span className="ml-auto">
            <ActionButton
              action={clientOffboard.bind(null, client.id)}
              label="Offboard client"
              variant="danger"
              confirm={`Offboard ${client.name}? Their Drive folder moves to Archive and this client becomes inactive.`}
            />
          </span>
        )}
      </div>

      {!driveConfigured && (
        <p className="text-sm text-amber-600 dark:text-amber-400">
          Google Drive isn&apos;t configured yet (GOOGLE_SA_KEY_JSON / DRIVE_SHARED_DRIVE_ID) —
          file uploads are disabled.
        </p>
      )}

      <Section title="Notes">
        {client.notionUrl ? (
          <div className="flex flex-col gap-2">
            <iframe
              src={client.notionUrl}
              className="h-[70vh] w-full rounded-lg border border-slate-200 dark:border-slate-800"
            />
            {canManage && (
              <details>
                <summary className="cursor-pointer select-none text-xs text-brand-600 hover:underline dark:text-brand-500">
                  Change linked page…
                </summary>
                <ActionForm
                  action={clientSetNotionUrl}
                  submitLabel="Save"
                  className="mt-2 flex max-w-lg flex-col gap-2"
                  resetOnSuccess={false}
                >
                  <input type="hidden" name="clientId" value={client.id} />
                  <input
                    name="notionUrl"
                    defaultValue={client.notionUrl}
                    placeholder="https://www.notion.so/…"
                    className={inputCls}
                  />
                </ActionForm>
              </details>
            )}
          </div>
        ) : canManage ? (
          <ActionForm action={clientSetNotionUrl} submitLabel="Link Notion page" className="flex max-w-lg flex-col gap-2">
            <input type="hidden" name="clientId" value={client.id} />
            <input name="notionUrl" placeholder="https://www.notion.so/…" className={inputCls} />
          </ActionForm>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">No notes page linked yet.</p>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {categories.map((category) => (
          <CategoryFilesButton
            key={category.key}
            clientId={client.id}
            category={category}
            files={filesByCategory.get(category.key) ?? []}
            canEdit={canEdit}
            canModify={canUploadCategory(category)}
            categories={categories}
            driveConfigured={driveConfigured}
          />
        ))}
      </div>

      {user.role !== "CLIENT" && (
        <div className="px-1">
          <AddCategoryButton />
        </div>
      )}

      <Section title="Upload activity">
        <MonthCalendar
          year={year}
          month={month}
          activeDays={activeDays}
          baseHref={`/client-hub/${client.id}`}
          taskDays={taskDays}
          fileActivityDays={fileActivityDays}
          canMarkUsed={user.role !== "CLIENT" && user.role !== "VIEWER"}
        />
      </Section>
    </div>
  );
}

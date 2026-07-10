import { notFound, redirect } from "next/navigation";
import { FileCategory } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { clientOffboard, clientSetNotionUrl } from "@/lib/actions";
import { ActionButton } from "@/components/action-button";
import { ActionForm } from "@/components/action-form";
import { ClientFileUploader } from "@/components/file-drop-uploader";
import { MonthCalendar } from "@/components/month-calendar";
import { CATEGORY_LABELS, CLIENT_WRITABLE_CATEGORIES, FILE_CATEGORIES } from "@/lib/file-categories";
import { driveViewLink, isDriveConfigured } from "@/lib/drive";
import { fmtDate } from "@/lib/format";
import { Section, FileLink } from "@/components/ui";

const inputCls =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-600 dark:bg-slate-800";

export default async function ClientHubDetailPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const session = await auth();
  const user = session?.user;
  if (!user?.isActive) redirect("/login");

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
  const canUploadCategory = (category: FileCategory) =>
    canManage || (user.role === "CLIENT" && CLIENT_WRITABLE_CATEGORIES.has(category));

  const files = await db.file.findMany({
    where: { clientId: id, category: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  const filesByCategory = new Map<FileCategory, typeof files>();
  for (const category of FILE_CATEGORIES) {
    filesByCategory.set(
      category,
      files.filter((f) => f.category === category),
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
  const uploads = await db.activityLog.findMany({
    where: { clientId: id, action: "file.uploaded", createdAt: { gte: monthStart, lt: monthEnd } },
    select: { createdAt: true },
  });
  const activeDays = new Set(uploads.map((u) => u.createdAt.toISOString().slice(0, 10)));

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

      {!isDriveConfigured() && (
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

      {FILE_CATEGORIES.map((category) => (
        <Section key={category} title={CATEGORY_LABELS[category]}>
          {(filesByCategory.get(category)?.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">No files yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {filesByCategory.get(category)!.map((f) => (
                <FileLink key={f.id} href={driveViewLink(f.driveFileId)} name={f.storedName} sizeBytes={f.sizeBytes} />
              ))}
            </ul>
          )}
          {canUploadCategory(category) && isDriveConfigured() && !client.offboardedAt && (
            <div className="mt-3">
              <ClientFileUploader clientId={client.id} category={category} />
            </div>
          )}
        </Section>
      ))}

      <Section title="Upload activity">
        <MonthCalendar
          year={year}
          month={month}
          activeDays={activeDays}
          baseHref={`/client-hub/${client.id}`}
        />
      </Section>
    </div>
  );
}

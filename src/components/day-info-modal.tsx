"use client";

import Link from "next/link";
import { TaskStatusBadge } from "@/components/status-badge";
import { ActionButton } from "@/components/action-button";
import { clientFilesSetUsed } from "@/lib/actions";
import { fmtDate } from "@/lib/format";
import type { DayTaskActivity } from "@/lib/task-calendar";
import type { CategoryUploadGroup } from "@/lib/file-activity-calendar";

function driveFolderLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

function CategoryGroupRows({ groups, canMarkUsed }: { groups: CategoryUploadGroup[]; canMarkUsed: boolean }) {
  if (groups.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Uploads
      </p>
      <ul className="flex flex-col gap-2.5">
        {groups.map((g) => {
          const folderHref = g.driveFolderId ? driveFolderLink(g.driveFolderId) : null;
          return (
            <li key={g.categoryKey} className="rounded-lg border border-slate-100 p-2 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                {folderHref ? (
                  <a
                    href={folderHref}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-sm font-semibold text-slate-700 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400"
                  >
                    {g.categoryLabel}
                  </a>
                ) : (
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{g.categoryLabel}</span>
                )}
                {canMarkUsed && (
                  <ActionButton
                    action={clientFilesSetUsed.bind(
                      null,
                      g.files.map((f) => f.fileId),
                      !g.allUsed,
                    )}
                    label={g.allUsed ? "Used ✓" : "Mark used"}
                    variant={g.allUsed ? "success" : "neutral"}
                  />
                )}
              </div>
              <ul className="mt-1.5 flex flex-col gap-0.5 pl-0.5">
                {g.files.map((f) =>
                  folderHref ? (
                    <li key={f.fileId}>
                      <a
                        href={folderHref}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="truncate text-xs text-slate-500 hover:text-brand-600 dark:text-slate-400 dark:hover:text-brand-400"
                      >
                        {f.name}
                      </a>
                      <span className="text-slate-400 dark:text-slate-500"> — {f.actorName}</span>
                    </li>
                  ) : (
                    <li key={f.fileId} className="truncate text-xs text-slate-500 dark:text-slate-400">
                      {f.name} — {f.actorName}
                    </li>
                  ),
                )}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TaskRows({ label, tasks }: { label: string; tasks: DayTaskActivity["initiated"] }) {
  if (tasks.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <ul className="flex flex-col gap-1.5">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 text-sm">
            <Link
              href={`/tasks/${t.id}`}
              className="truncate text-slate-700 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-400"
            >
              {t.title}
            </Link>
            <div className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs text-slate-400 dark:text-slate-500">{fmtDate(t.date)}</span>
              <TaskStatusBadge status={t.status} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DayInfoModal({
  dateLabel,
  fileGroups,
  tasks,
  canMarkUsed = false,
  onClose,
}: {
  dateLabel: string;
  fileGroups: CategoryUploadGroup[];
  tasks: DayTaskActivity;
  canMarkUsed?: boolean;
  onClose: () => void;
}) {
  const isEmpty = fileGroups.length === 0 && tasks.initiated.length === 0 && tasks.due.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{dateLabel}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3">
          <CategoryGroupRows groups={fileGroups} canMarkUsed={canMarkUsed} />
          <TaskRows label="Initiated" tasks={tasks.initiated} />
          <TaskRows label="Due" tasks={tasks.due} />
          {isEmpty && <p className="text-sm text-slate-400 dark:text-slate-500">Nothing on this day.</p>}
        </div>
      </div>
    </div>
  );
}

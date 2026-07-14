"use client";

import Link from "next/link";
import { TaskStatusBadge } from "@/components/status-badge";
import { ActionButton } from "@/components/action-button";
import { clientFileSetUsed } from "@/lib/actions";
import { fmtDate } from "@/lib/format";
import type { DayTaskActivity } from "@/lib/task-calendar";
import type { FileActivityEntry } from "@/lib/file-activity-calendar";

function FileEventRows({ events, canMarkUsed }: { events: FileActivityEntry[]; canMarkUsed: boolean }) {
  if (events.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Uploads
      </p>
      <ul className="flex flex-col gap-2">
        {events.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 text-sm text-slate-700 dark:text-slate-300">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{e.actorName}</span> {e.description}
            </span>
            {canMarkUsed && (
              <span className="shrink-0">
                <ActionButton
                  action={clientFileSetUsed.bind(null, e.fileId, !e.markedUsed)}
                  label={e.markedUsed ? "Used ✓" : "Mark used"}
                  variant={e.markedUsed ? "success" : "neutral"}
                />
              </span>
            )}
          </li>
        ))}
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
  fileEvents,
  tasks,
  canMarkUsed = false,
  onClose,
}: {
  dateLabel: string;
  fileEvents: FileActivityEntry[];
  tasks: DayTaskActivity;
  canMarkUsed?: boolean;
  onClose: () => void;
}) {
  const isEmpty = fileEvents.length === 0 && tasks.initiated.length === 0 && tasks.due.length === 0;

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
          <FileEventRows events={fileEvents} canMarkUsed={canMarkUsed} />
          <TaskRows label="Initiated" tasks={tasks.initiated} />
          <TaskRows label="Due" tasks={tasks.due} />
          {isEmpty && <p className="text-sm text-slate-400 dark:text-slate-500">Nothing on this day.</p>}
        </div>
      </div>
    </div>
  );
}

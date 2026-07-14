"use client";

import type { DayTaskActivity } from "@/lib/task-calendar";
import type { FileActivityEntry } from "@/lib/file-activity-calendar";

const MAX_PREVIEW = 4;

function TaskLines({ label, tasks }: { label: string; tasks: DayTaskActivity["initiated"] }) {
  if (tasks.length === 0) return null;
  const shown = tasks.slice(0, MAX_PREVIEW);
  const remaining = tasks.length - shown.length;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {shown.map((t) => (
          <li key={t.id} className="truncate text-xs text-slate-700 dark:text-slate-300">
            {t.title}
          </li>
        ))}
        {remaining > 0 && (
          <li className="text-xs text-slate-400 dark:text-slate-500">+{remaining} more</li>
        )}
      </ul>
    </div>
  );
}

function FileEventLines({ events }: { events: FileActivityEntry[] }) {
  if (events.length === 0) return null;
  const shown = events.slice(0, MAX_PREVIEW);
  const remaining = events.length - shown.length;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Uploads
      </p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {shown.map((e) => (
          <li key={e.id} className="truncate text-xs text-slate-700 dark:text-slate-300">
            {e.actorName} {e.description}
          </li>
        ))}
        {remaining > 0 && (
          <li className="text-xs text-slate-400 dark:text-slate-500">+{remaining} more</li>
        )}
      </ul>
    </div>
  );
}

export function DayHoverCard({
  dateLabel,
  fileEvents,
  tasks,
}: {
  dateLabel: string;
  fileEvents: FileActivityEntry[];
  tasks: DayTaskActivity;
}) {
  return (
    <div className="w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{dateLabel}</p>
      <div className="mt-2 flex flex-col gap-2">
        <FileEventLines events={fileEvents} />
        <TaskLines label="Initiated" tasks={tasks.initiated} />
        <TaskLines label="Due" tasks={tasks.due} />
      </div>
    </div>
  );
}

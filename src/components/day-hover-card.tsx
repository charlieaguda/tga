"use client";

import type { DayTaskActivity } from "@/lib/task-calendar";

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

export function DayHoverCard({
  dateLabel,
  uploaded,
  tasks,
}: {
  dateLabel: string;
  uploaded: boolean;
  tasks: DayTaskActivity;
}) {
  return (
    <div className="w-56 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-800 dark:bg-slate-900">
      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{dateLabel}</p>
      <div className="mt-2 flex flex-col gap-2">
        {uploaded && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400">Creatives uploaded</p>
        )}
        <TaskLines label="Initiated" tasks={tasks.initiated} />
        <TaskLines label="Due" tasks={tasks.due} />
      </div>
    </div>
  );
}

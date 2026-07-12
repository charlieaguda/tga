"use client";

import { useEffect, useState } from "react";
import { DayHoverCard } from "@/components/day-hover-card";
import { DayInfoModal } from "@/components/day-info-modal";
import type { DayTaskActivity } from "@/lib/task-calendar";

const EMPTY: DayTaskActivity = { initiated: [], due: [] };

export function DayCell({
  day,
  dateKey,
  active,
  tasks,
}: {
  day: number;
  dateKey: string;
  active: boolean;
  tasks?: DayTaskActivity;
}) {
  const [hovered, setHovered] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const dayTasks = tasks ?? EMPTY;
  const hasTasks = dayTasks.initiated.length > 0 || dayTasks.due.length > 0;
  const interactive = active || hasTasks;

  const dateLabel = new Date(`${dateKey}T00:00:00Z`).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <div className="relative">
      <div
        onMouseEnter={interactive ? () => setHovered(true) : undefined}
        onMouseLeave={interactive ? () => setHovered(false) : undefined}
        onClick={interactive ? () => setOpen(true) : undefined}
        className={`flex h-9 items-center justify-center rounded-md text-sm ${
          interactive ? "cursor-pointer hover:ring-1 hover:ring-brand-300" : ""
        } ${
          active
            ? "bg-emerald-100 font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200"
            : "text-gray-500"
        }`}
      >
        {day}
        {(dayTasks.initiated.length > 0 || dayTasks.due.length > 0) && (
          <div className="absolute bottom-0.5 left-1/2 flex -translate-x-1/2 gap-0.5">
            {dayTasks.initiated.length > 0 && (
              <span className="h-1 w-1 rounded-full bg-brand-500 dark:bg-brand-400" />
            )}
            {dayTasks.due.length > 0 && (
              <span className="h-1 w-1 rounded-full bg-amber-500 dark:bg-amber-400" />
            )}
          </div>
        )}
      </div>

      {hovered && interactive && !open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2">
          <DayHoverCard dateLabel={dateLabel} uploaded={active} tasks={dayTasks} />
        </div>
      )}

      {open && (
        <DayInfoModal dateLabel={dateLabel} uploaded={active} tasks={dayTasks} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

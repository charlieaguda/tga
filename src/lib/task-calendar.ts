import type { TaskStatus } from "@prisma/client";

export interface TaskCalendarEntry {
  id: string;
  title: string;
  status: TaskStatus;
  date: Date;
}

export interface DayTaskActivity {
  initiated: TaskCalendarEntry[];
  due: TaskCalendarEntry[];
}

export type TaskDaysMap = Record<string, DayTaskActivity>;

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function buildTaskDaysMap(
  tasks: { id: string; title: string; status: TaskStatus; createdAt: Date; dueAt: Date | null }[],
): TaskDaysMap {
  const map: TaskDaysMap = {};

  const bucket = (key: string): DayTaskActivity => {
    if (!map[key]) map[key] = { initiated: [], due: [] };
    return map[key];
  };

  for (const t of tasks) {
    bucket(dayKey(t.createdAt)).initiated.push({ id: t.id, title: t.title, status: t.status, date: t.createdAt });
    if (t.dueAt) {
      bucket(dayKey(t.dueAt)).due.push({ id: t.id, title: t.title, status: t.status, date: t.dueAt });
    }
  }

  return map;
}
